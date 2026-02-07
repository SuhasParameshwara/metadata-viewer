import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MetadataViewer } from './metadata-viewer';

describe('MetadataViewer', () => {
  let component: MetadataViewer;
  let fixture: ComponentFixture<MetadataViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MetadataViewer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MetadataViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
