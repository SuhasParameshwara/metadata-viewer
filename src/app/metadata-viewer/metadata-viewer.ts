import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { unzipSync, strFromU8, gunzipSync } from 'fflate';

interface AttributeRow {
  name: string;
  value: string;
  decoded?: string;
}

interface ContentControl {
  title: string;
  tag: string;
  attributes: AttributeRow[];
  children?: ContentControl[];
  expanded?: boolean;
}

@Component({
  selector: 'app-metadata-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metadata-viewer.html',
  styleUrl: './metadata-viewer.scss',
})
export class MetadataViewerComponent {
  controls: ContentControl[] = [];
  selectedControl?: ContentControl;
  loading = false;
  selectedFileName = '';
  private cdr = inject(ChangeDetectorRef);
  decodedValues: Record<string, string> = {};
  totalFields = 0;
  totalClauses = 0;
  totalTables = 0;

  async onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (!this.isValidWordFile(file)) {
      alert('Only .doc or .docx files are supported.');
      return;
    }
    this.totalFields = 0;
    this.totalClauses = 0;
    this.totalTables = 0;
    this.selectedFileName = file.name;
    this.loading = true;

    const buffer = await file.arrayBuffer();
    const zip = unzipSync(new Uint8Array(buffer));

    const parser = new DOMParser();

    // 1. Read document.xml
    const docXml = strFromU8(zip['word/document.xml']);
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');

    // 2. Extract metadata from customXml
    const metadataMap: Record<string, any> = {};

    Object.keys(zip).forEach((path) => {
      if (path.startsWith('customXml/item') && path.endsWith('.xml')) {
        try {
          const rawXml = strFromU8(zip[path]);
          const xmlDoc = parser.parseFromString(rawXml, 'application/xml');

          // -------------------------------
          // CASE 1: Clause/Field metadata
          // -------------------------------
          const nodes = xmlDoc.getElementsByTagName('Node');

          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            const id =
              node.getAttribute('p2:id') || node.getAttribute('id');

            if (!id) continue;

            const base64 = node.textContent?.trim();
            if (!base64) continue;

            const decoded = Uint8Array.from(atob(base64), (c) =>
              c.charCodeAt(0)
            );

            const decompressed = gunzipSync(decoded);
            const metadataXml = strFromU8(decompressed);

            const metaDoc = parser.parseFromString(
              metadataXml,
              'application/xml'
            );
            const metadataNode =
              metaDoc.getElementsByTagName('Metadata')[0];
            if (!metadataNode) continue;

            const meta: any = {};
            for (let j = 0; j < metadataNode.children.length; j++) {
              const child = metadataNode.children[j];
              meta[child.nodeName] = child.textContent || '';
            }

            metadataMap[id] = meta;
          }

          // --------------------------------
          // CASE 2: Document Properties
          // --------------------------------
          const docProps =
            xmlDoc.getElementsByTagName('Properties')[0];

          if (docProps) {
            const base64 = docProps.textContent?.trim();

            if (base64) {
              const decoded = Uint8Array.from(atob(base64), (c) =>
                c.charCodeAt(0)
              );

              const decompressed = gunzipSync(decoded);
              const metadataXml = strFromU8(decompressed);

              const metaDoc = parser.parseFromString(
                metadataXml,
                'application/xml'
              );

              const root = metaDoc.documentElement;

              const meta: any = {};
              for (let j = 0; j < root.children.length; j++) {
                const child = root.children[j];
                meta[child.nodeName] = child.textContent || '';
              }

              // store with special key
              metadataMap['DocumentProperty'] = meta;
            }
          }
        } catch (e) {
          console.warn('Failed to parse', path, e);
        }
      }
    });



    // 3. Build tree recursively
    const body = xmlDoc.getElementsByTagName('w:body')[0];
    const results = this.buildTree(body, metadataMap);

    this.controls = results;
    // Add DocumentProperty node if exists
    if (metadataMap['DocumentProperty']) {
      const meta = metadataMap['DocumentProperty'];

      const attributes: AttributeRow[] = [];

      Object.keys(meta).forEach((key) => {
        attributes.push({
          name: key,
          value: String(meta[key] ?? ''),
        });
      });

      this.controls.unshift({
        title: 'DocumentProperty',
        tag: '',
        attributes,
        children: [],
        expanded: false,
      });
    }
    this.selectedControl = results[0];
    this.loading = false;
    this.cdr.markForCheck();
  }

  // Recursive tree builder
  private buildTree(parent: Element, metadataMap: Record<string, any>): ContentControl[] {
    const result: ContentControl[] = [];

    const children = parent.children;

    for (let i = 0; i < children.length; i++) {
      const node = children[i];

      if (node.localName === 'sdt') {
        const control = this.createControl(node, metadataMap);
        result.push(control);
      } else {
        // search deeper
        result.push(...this.buildTree(node, metadataMap));
      }
    }

    return result;
  }

  // Create single control with recursion
  private createControl(node: Element, metadataMap: Record<string, any>): ContentControl {
    const pr = node.getElementsByTagName('w:sdtPr')[0];

    const idNode = pr?.getElementsByTagName('w:id')[0];
    const aliasNode = pr?.getElementsByTagName('w:alias')[0];
    const tagNode = pr?.getElementsByTagName('w:tag')[0];

    const id = idNode?.getAttribute('w:val') || '';
    const alias = aliasNode?.getAttribute('w:val') || '';
    const tag = tagNode?.getAttribute('w:val') || '';

    const meta = metadataMap[id] || {};


    // ---- COUNT LOGIC ----
    const type = (meta['Alias'] || alias || '').toLowerCase();

    if (type.includes('field')) {
      this.totalFields++;
    } else if (type.includes('clause')) {
      this.totalClauses++;
    } else if (type.includes('repeat')) {
      this.totalTables++;
    }

    const attributes: AttributeRow[] = [
      { name: 'ID (Unsigned)', value: id },
      { name: 'Alias', value: alias },
    ];

    Object.keys(meta).forEach((key) => {
      attributes.push({
        name: key,
        value: String(meta[key] ?? ''),
      });
    });

    // find nested controls
    const children: ContentControl[] = [];
    const content = node.getElementsByTagName('w:sdtContent')[0];

    if (content) {
      const nested = this.buildTree(content, metadataMap);
      children.push(...nested);
    }

    return {
      title: meta['Tag'] ? `${alias} - ${meta['Tag']}` : alias,
      tag,
      attributes,
      children,
      expanded: false,
    };
  }

  selectControl(control: ContentControl) {
    this.selectedControl = control;
  }

  toggleNode(node: ContentControl, event: Event) {
    event.stopPropagation();
    node.expanded = !node.expanded;
  }

  decodeBaseValue(attr: AttributeRow) {
    try {
      const decoded = atob(attr.value);
      attr.decoded = decoded;
      this.cdr.markForCheck();
    } catch (e) {
      attr.decoded = 'Invalid Base64 content';
    }
  }

  onFileDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    if (!this.isValidWordFile(file)) {
      alert('Only .doc or .docx files are supported.');
      return;
    }

    const fakeEvent = { target: { files: [file] } };
    this.onFileSelected(fakeEvent);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  private isValidWordFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return name.endsWith('.doc') || name.endsWith('.docx');
  }
}
