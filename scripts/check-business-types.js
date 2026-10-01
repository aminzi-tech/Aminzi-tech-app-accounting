// Validates config/business-types.json (or BUSINESS_TYPES_FILE) and prints the list.
// Run after every edit: npm run check-types
try {
  const registry = require('../server/provisioning/registry');
  registry.refresh();
  const list = registry.publicList();
  for (const t of list) console.log(`${t.id.padEnd(22)} ${t.label.padEnd(32)} ${t.group}`);
  console.log(`\nOK — ${list.length} enabled business types.`);
} catch (e) {
  console.error(`Registry error: ${e.message}`);
  process.exit(1);
}
