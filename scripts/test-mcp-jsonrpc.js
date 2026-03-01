const { spawn } = require('child_process');
const path = require('path');

// Use project's mongodb module
const mongoPath = path.join(__dirname, '..', 'mcp-servers', 'scout-quest', 'node_modules', 'mongodb');
const { MongoClient } = require(mongoPath);

async function getScoutEmail() {
  const client = new MongoClient('mongodb://localhost:27017/scoutquest');
  await client.connect();
  const scout = await client.db('scoutquest').collection('scouts').findOne(
    { 'quest_state.quest_status': { $exists: true } },
    { projection: { email: 1, name: 1 } }
  );
  await client.close();
  return scout;
}

async function testMcpServer(scoutEmail, scoutName) {
  console.log(`Testing MCP server for scout: ${scoutName} (${scoutEmail})\n`);

  const server = spawn('node', [
    path.join(__dirname, '..', 'mcp-servers', 'scout-quest', 'dist', 'scout.js')
  ], {
    env: {
      ...process.env,
      MONGO_URI: 'mongodb://localhost:27017/scoutquest',
      SCOUT_EMAIL: scoutEmail,
      PATH: process.env.PATH
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let buffer = '';
  const responses = [];

  server.stderr.on('data', (d) => console.error('[MCP STDERR]:', d.toString().trim()));
  server.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          responses.push(msg);
          console.log('[RESPONSE]:', JSON.stringify(msg, null, 2));
        } catch(e) {
          console.log('[RAW]:', line);
        }
      }
    }
  });

  function send(msg) {
    const str = JSON.stringify(msg) + '\n';
    console.log('[SEND]:', JSON.stringify(msg));
    server.stdin.write(str);
  }

  // Initialize
  await new Promise(r => setTimeout(r, 500));
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
  await new Promise(r => setTimeout(r, 1000));

  // List tools
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await new Promise(r => setTimeout(r, 1000));

  // List resources
  send({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  await new Promise(r => setTimeout(r, 1000));

  // Read quest-state resource
  send({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'scout://quest-state' } });
  await new Promise(r => setTimeout(r, 2000));

  // Call advance_requirement tool
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'advance_requirement',
      arguments: { req_id: 'fl_1', new_status: 'in_progress' }
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  server.stdin.end();
  await new Promise(r => setTimeout(r, 500));
  server.kill();

  console.log('\n--- TEST COMPLETE ---');
  console.log(`Total responses received: ${responses.length}`);
}

getScoutEmail().then(scout => {
  if (!scout) throw new Error('No scouts in DB');
  return testMcpServer(scout.email, scout.name);
}).catch(console.error);
