// §ORG-LEVELS — the canonical semantic level vocabulary. Kept in its
// own module so the scope/boundary engine can import the type without
// pulling the label maps (client-safe, no graph dependency).

export type OrgNodeLevel =
  | 'general_administration'
  | 'company'
  | 'department'
  | 'team'
  | 'subteam';
