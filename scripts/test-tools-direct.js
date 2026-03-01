// Direct test of MCP tool handlers against real MongoDB data
const path = require('path');
process.env.MONGO_URI = 'mongodb://localhost:27017/scoutquest';

// Use mongodb from the MCP server's node_modules
const MCP_ROOT = path.join(__dirname, '..', 'mcp-servers', 'scout-quest');

async function main() {
  const { MongoClient } = require(path.join(MCP_ROOT, 'node_modules', 'mongodb'));
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db('scoutquest');

  console.log('=== MCP Tools Direct Test ===\n');

  // List all collections
  const collections = await db.listCollections().toArray();
  console.log('Collections:', collections.map(c => c.name).join(', '));
  console.log('');

  // Get first scout
  const scout = await db.collection('scouts').findOne({}, { projection: { email: 1, name: 1, quest_state: 1 } });
  if (!scout) {
    console.error('ERROR: No scouts found in database!');
    await client.close();
    process.exit(1);
  }
  console.log('--- Scout ---');
  console.log('Name:', scout.name);
  console.log('Email:', scout.email);
  console.log('');

  // Test quest-state
  console.log('--- Quest State ---');
  const questState = scout.quest_state;
  if (questState) {
    console.log('Current rank:', questState.current_rank || 'not set');
    console.log('Target rank:', questState.target_rank || 'not set');
    console.log(JSON.stringify(questState, null, 2));
  } else {
    console.log('No quest_state field on scout document');
  }
  console.log('');

  // Test requirements
  console.log('--- Requirements ---');
  const reqs = await db.collection('requirements').find({ scout_email: scout.email }).toArray();
  console.log('Total requirements:', reqs.length);
  if (reqs.length > 0) {
    // Group by prefix
    const prefixes = {};
    for (const r of reqs) {
      const prefix = r.req_id ? r.req_id.split('.')[0] : 'unknown';
      prefixes[prefix] = (prefixes[prefix] || 0) + 1;
    }
    console.log('By prefix:', JSON.stringify(prefixes));

    // Group by status
    const statuses = {};
    for (const r of reqs) {
      const status = r.status || 'unknown';
      statuses[status] = (statuses[status] || 0) + 1;
    }
    console.log('By status:', JSON.stringify(statuses));

    // Show first requirement as sample
    console.log('Sample requirement:', JSON.stringify(reqs[0], null, 2));
  }
  console.log('');

  // Test users collection
  console.log('--- Users ---');
  const users = await db.collection('users').find({}, { projection: { email: 1, name: 1, role: 1, _id: 0 } }).limit(10).toArray();
  console.log('Users (up to 10):');
  for (const u of users) {
    console.log(`  ${u.name || '(no name)'} <${u.email || '(no email)'}> role=${u.role || '(none)'}`);
  }
  console.log('');

  // Test chores collection
  console.log('--- Chores ---');
  const choresCount = await db.collection('chores').countDocuments({ scout_email: scout.email });
  console.log('Chore count for scout:', choresCount);
  if (choresCount > 0) {
    const chore = await db.collection('chores').findOne({ scout_email: scout.email });
    console.log('Sample chore:', JSON.stringify(chore, null, 2));
  }
  console.log('');

  // Test reminders collection
  console.log('--- Reminders ---');
  const remindersCount = await db.collection('reminders').countDocuments({});
  console.log('Total reminders:', remindersCount);
  if (remindersCount > 0) {
    const reminder = await db.collection('reminders').findOne({});
    console.log('Sample reminder:', JSON.stringify(reminder, null, 2));
  }
  console.log('');

  // Test calendar_events collection
  console.log('--- Calendar Events ---');
  const eventsExist = collections.some(c => c.name === 'calendar_events');
  if (eventsExist) {
    const eventsCount = await db.collection('calendar_events').countDocuments({});
    console.log('Total calendar events:', eventsCount);
    if (eventsCount > 0) {
      const event = await db.collection('calendar_events').findOne({});
      console.log('Sample event:', JSON.stringify(event, null, 2));
    }
  } else {
    console.log('calendar_events collection does not exist');
  }
  console.log('');

  // Summary
  console.log('=== Summary ===');
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments({});
    console.log(`  ${col.name}: ${count} documents`);
  }

  await client.close();
  console.log('\nAll checks passed!');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
