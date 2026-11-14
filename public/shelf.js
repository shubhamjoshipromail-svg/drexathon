// Constitution shelf: real documents NDI reads (first read live, then served from the labelled NDI cache).
// kind: 'pdf' (path under /samples), 'url' (NDI reads the web page), 'wiki' (MediaWiki API text -> PDF -> NDI). evidence: optional sample evidence PDFs.
export const SHELF = [
  { id: 'mine', name: 'My constitution', blurb: 'A personal constitution: six ministries, Health and Family hold vetoes, 2/3 for job changes.', kind: 'pdf', source: '/samples/constitution.pdf',
    evidence: ['/samples/offer-letter.pdf'], motion: 'Should I quit my job to join Lumen Labs as founding engineer?' },
  { id: 'rome', name: 'Roman Republic', blurb: 'Rome\'s unwritten constitution as described on Wikipedia (CC BY-SA): Senate, consuls, tribunes with the veto.', kind: 'wiki',
    site: 'en.wikipedia.org', source: 'Constitution of the Roman Republic', motion: 'Should the Senate name Julius Caesar dictator for life?' },
  { id: 'us', name: 'United States', blurb: 'The U.S. Constitution, full text from the National Archives.', kind: 'url',
    source: 'https://www.archives.gov/founding-docs/constitution-transcript', motion: 'Should the federal government adopt a four-day work week for all federal employees?' },
  { id: 'japan', name: 'Japan', blurb: 'The Constitution of Japan (1947) as described on Wikipedia (CC BY-SA): the Diet, the Cabinet, the Emperor, 2/3 to amend.', kind: 'wiki',
    site: 'en.wikipedia.org', source: 'Constitution of Japan', motion: 'Should Japan amend Article 9 to allow a standing army?' },
];
