// Built-in severity-suggestion rules. These are configurable defaults, not medical or rescue decisions.
// Additional rules can be created at runtime through /api/v1/escalation-rules; both sets are evaluated and
// the highest matching level wins. Coordinators always confirm or override the suggestion with a reason.
//
// Condition keys (all optional, all must match):
//   categories            request category is one of these
//   minPeopleAffected     peopleAffected >= value
//   minVulnerableCount    vulnerableCount >= value (children, elderly, disabled, pregnant — only if supplied)
//   minTotalQuantity      sum of requested quantities >= value
//   inActiveZone          request is linked to an ACTIVE disaster zone
//   minZoneSeverity       linked zone severity >= value
//   minAgeMinutes         request has waited unverified for at least this long (evaluated by the escalation job)

export const BUILT_IN_RULES = [
  {
    id: 'builtin-water-medicine-50',
    name: 'Water or medicine for 50+ people',
    conditions: { categories: ['WATER', 'MEDICINE'], minPeopleAffected: 50 },
    resultingSeverity: 'HIGH',
  },
  {
    id: 'builtin-large-group',
    name: 'Large affected group (200+ people)',
    conditions: { minPeopleAffected: 200 },
    resultingSeverity: 'HIGH',
  },
  {
    id: 'builtin-medicine-vulnerable',
    name: 'Medicine needed with 10+ vulnerable people',
    conditions: { categories: ['MEDICINE'], minVulnerableCount: 10 },
    resultingSeverity: 'RED',
  },
  {
    id: 'builtin-critical-zone-essentials',
    name: 'Water, food or medicine inside an active critical zone',
    conditions: { categories: ['WATER', 'FOOD', 'MEDICINE'], inActiveZone: true, minZoneSeverity: 'RED' },
    resultingSeverity: 'RED',
  },
  {
    id: 'builtin-very-large-group',
    name: 'Very large affected group (500+ people)',
    conditions: { minPeopleAffected: 500 },
    resultingSeverity: 'RED',
  },
  {
    id: 'builtin-exceptional',
    name: 'Medicine or water for 25+ vulnerable people inside an active zone',
    conditions: { categories: ['MEDICINE', 'WATER'], minVulnerableCount: 25, inActiveZone: true },
    resultingSeverity: 'HYPER_RED',
  },
  {
    id: 'builtin-waiting-critical',
    name: 'Essentials waiting unverified for over 6 hours',
    conditions: { categories: ['WATER', 'MEDICINE'], minAgeMinutes: 360 },
    resultingSeverity: 'HIGH',
  },
];
