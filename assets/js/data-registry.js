/* KCNA content registry. Data files call KCNA.register(domain). */
window.KCNA = (function () {
  const domains = [];
  const referencesByDomain = {};   // domainId -> [{topic,title,url,note}]
  const glossaryTerms = [];        // [{term,definition,domain,sourceUrl}]

  const meta = {
    version: '1.9.0',
    examName: 'KCNA',
    examFull: 'Kubernetes and Cloud Native Associate',
    passPct: 75,        // CNCF passing score
    examQuestions: 60,  // questions on the real exam
    examMinutes: 90,    // duration
    examDate: '2026-10-01',   // company-wide deadline: pass the KCNA by Oct 1, 2026
    planStart: '2026-06-17',
  };

  function register(domain) {
    // Ensure stable ids exist on every item (defensive — data files set them).
    (domain.notes || []).forEach((n, i) => { if (!n.id) n.id = domain.id + '-note-' + (i + 1); n.domainId = domain.id; });
    (domain.flashcards || []).forEach((c, i) => { if (!c.id) c.id = domain.id + '-fc-' + (i + 1); c.domainId = domain.id; });
    (domain.questions || []).forEach((q, i) => { if (!q.id) q.id = domain.id + '-q-' + (i + 1); q.domainId = domain.id; });
    domains.push(domain);
  }

  // Optional knowledge-base data (loaded from data/references.js, data/glossary.js).
  function registerReferences(domainId, refs) {
    referencesByDomain[domainId] = (referencesByDomain[domainId] || []).concat(refs || []);
  }
  function registerGlossary(terms) {
    (terms || []).forEach((t) => glossaryTerms.push(t));
  }

  return {
    meta,
    register,
    registerReferences,
    registerGlossary,
    references(domainId) { return (referencesByDomain[domainId] || []).slice(); },
    allReferences() { return Object.assign({}, referencesByDomain); },
    hasReferences() { return Object.keys(referencesByDomain).length > 0; },
    glossary() { return glossaryTerms.slice().sort((a, b) => a.term.localeCompare(b.term)); },
    hasGlossary() { return glossaryTerms.length > 0; },
    domains,
    ready() { return domains.length > 0; },
    all() { return domains.slice(); },
    domain(id) { return domains.find((d) => d.id === id); },
    totalWeight() { return domains.reduce((s, d) => s + (d.weight || 0), 0); },
    allQuestions() {
      return domains.flatMap((d) =>
        (d.questions || []).map((q) => Object.assign({}, q, { domainId: d.id, domainName: d.name })));
    },
    allFlashcards() {
      return domains.flatMap((d) =>
        (d.flashcards || []).map((c) => Object.assign({}, c, { domainId: d.id, domainName: d.name })));
    },
    counts() {
      return {
        domains: domains.length,
        notes: domains.reduce((s, d) => s + (d.notes || []).length, 0),
        flashcards: domains.reduce((s, d) => s + (d.flashcards || []).length, 0),
        questions: domains.reduce((s, d) => s + (d.questions || []).length, 0),
      };
    },
  };
})();
