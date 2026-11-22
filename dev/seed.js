'use strict';
// Placeholder content for local previews only. Never deployed.
module.exports = function seed(mocks) {
  const now = Date.now(), day = 864e5;
  const sections = [
    { id: 'sA', kind: 'lecture', title: 'Section One' },
    { id: 'sB', kind: 'lecture', title: 'Section Two' },
    { id: 'sC', kind: 'lecture', title: 'Section Three' },
    { id: 'sD', kind: 'breakdown', title: 'Week One' },
    { id: 'sE', kind: 'breakdown', title: 'Week Two' },
  ];
  const items = [];
  function add(sec, kind, title, desc, len, ago) {
    const id = 'i' + (items.length + 1);
    const vid = 'vidseed' + (items.length + 1);
    mocks.videos[vid] = { status: 'ready', length: len };
    items.push({ id, kind, sectionId: sec, title, desc, status: 'ready',
      videoId: vid, length: len, added: now - ago * day });
  }
  add('sA', 'lecture', 'Placeholder Lecture One', 'Short placeholder description.', 2710, 60);
  add('sA', 'lecture', 'Placeholder Lecture Two', '', 1984, 58);
  add('sA', 'lecture', 'Placeholder Lecture Three', '', 3122, 50);
  add('sA', 'lecture', 'Placeholder Lecture Four', '', 2405, 44);
  add('sB', 'lecture', 'Placeholder Lecture Five', '', 2890, 30);
  add('sB', 'lecture', 'Placeholder Lecture Six', '', 1760, 24);
  add('sB', 'lecture', 'Placeholder Lecture Seven', '', 3540, 20);
  add('sC', 'lecture', 'Placeholder Lecture Eight', '', 2230, 6);
  add('sC', 'lecture', 'Placeholder Lecture Nine', '', 2610, 3);
  add('sD', 'breakdown', 'Placeholder Breakdown Monday', '', 910, 12);
  add('sD', 'breakdown', 'Placeholder Breakdown Tuesday', '', 845, 11);
  add('sD', 'breakdown', 'Placeholder Breakdown Wednesday', '', 1022, 10);
  add('sE', 'breakdown', 'Placeholder Breakdown Thursday', '', 780, 2);
  add('sE', 'breakdown', 'Placeholder Breakdown Friday', '', 990, 1);
  items[items.length - 1].tier = 'Elite';
  const content = { sections, items,
    announcement: { text: 'Placeholder announcement text goes here.',
      link: 'https://example.com', t: now - day } };
  mocks.store.set('elevare:content', JSON.stringify(content));
  mocks.store.set('elevare:seen:100000000000000002', new Set(['i1', 'i2', 'i3', 'i4', 'i5']));
  mocks.store.set('elevare:done:100000000000000002', new Set(['i1', 'i2', 'i3', 'i4']));
};
