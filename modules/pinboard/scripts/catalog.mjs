// Public routes and preparation order, matching the homepage cards.
// This registry also ships with standalone shared-app preparation helpers.
export const APPS = [
  { id: 'utility-desk', folder: 'utility-desk-lite', label: 'Utility Desk Lite', kind: 'utility' },
  { id: 'iou', folder: 'iou', label: 'iou', kind: 'iou' },
  { id: 'drafts', folder: 'drafts', label: 'Drafts', kind: 'drafts' },
  { id: 'textdrop', folder: 'textdrop', label: 'TextDrop', kind: 'shared' },
  { id: 'pinboard', folder: 'pinboard', label: 'Pinboard', kind: 'shared' },
  { id: 'blueprint', folder: 'blueprint', label: 'Blueprint', kind: 'shared' },
];

export const VITE_APPS = APPS.filter(app => app.kind !== 'drafts');
export const SHARED_APPS = APPS.filter(app => app.kind === 'shared');
