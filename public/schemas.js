// NDI extract schemas (shared by the app and the P0 gate scripts).
export const CONSTITUTION_SCHEMA = { type: 'object', properties: {
  ministries: { type: 'array', description: 'Every body that votes on or can block decisions, as defined in the document: ministries, departments, roles, or for a national/organisational constitution its branches, houses and offices (e.g. House of Representatives, Senate, President, board, members).', items: { type: 'object', properties: {
    name: { type: 'string', description: 'Ministry name, e.g. Ministry of Health' },
    mandate: { type: 'string', description: 'What this ministry protects or is responsible for, one sentence' },
    vote_weight: { type: 'number', description: 'Its vote weight (number of votes). 1 if not stated.' },
    has_veto: { type: 'boolean', description: 'True only if the document explicitly gives this ministry a veto' },
    veto_scope: { type: 'string', description: 'If it has a veto: exactly which decisions the veto covers. Empty string otherwise.' },
  } } },
  rules: { type: 'array', description: 'Every standing rule, limit or protected right that decisions must respect (numbered rules such as Rule 2.1, or clauses/amendments in a national constitution). Max 25, most important first. Not the passage or override articles.', items: { type: 'object', properties: {
    id: { type: 'string', description: 'Rule number as written, e.g. 2.1' },
    text: { type: 'string', description: 'The rule, as one clear sentence' },
    // applies_to: for national constitutions, the branch it constrains most, or 'all'
    applies_to: { type: 'string', description: 'Name of the ministry the rule belongs to, or "all" if it binds all ministries' },
  } } },
  passage: { type: 'object', properties: {
    default_threshold: { type: 'string', enum: ['simple', 'three_fifths', 'two_thirds', 'unanimous'], description: 'Majority of weighted votes normally needed to pass a decision' },
    special: { type: 'array', description: 'Decisions that need a different threshold', items: { type: 'object', properties: {
      condition: { type: 'string', description: 'Which decisions this applies to' },
      threshold: { type: 'string', enum: ['simple', 'three_fifths', 'two_thirds', 'unanimous'] },
    } } },
  } },
  leader: { type: 'object', properties: {
    can_override_veto: { type: 'boolean', description: 'Can the leader / prime minister override a veto at all?' },
    override_requires: { type: 'string', description: 'What the leader needs in order to override a veto' },
    override_threshold: { type: 'string', enum: ['none', 'simple', 'three_fifths', 'two_thirds', 'unanimous'], description: 'Weighted-vote majority the override needs; none if no vote is required' },
    override_needs_condition: { type: 'boolean', description: 'True if the override also needs the vetoing ministry\'s condition to be written down and accepted' },
  } },
} };

export const EVIDENCE_SCHEMA = { type: 'object', properties: {
  facts: { type: 'array', description: 'Every concrete, decision-relevant fact in the document: money amounts, percentages, dates, durations, hours, locations, obligations, risks. One fact per item.', items: { type: 'object', properties: {
    id: { type: 'string', description: 'Short snake_case id, e.g. base_salary' },
    fact: { type: 'string', description: 'The fact as one short sentence with its number' },
    topic: { type: 'string', enum: ['money', 'equity', 'time', 'location', 'health', 'risk', 'other'] },
  } } },
} };
