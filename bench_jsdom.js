const { JSDOM } = require('jsdom');
const { performance } = require('perf_hooks');

const dom = new JSDOM(`<!DOCTYPE html><div id="toggle-conn-7" checked></div><div id="toggle-conn-1" checked></div><div id="toggle-conn-2" checked></div>`);
global.document = dom.window.document;

const N = 10000;
let npcsData = [];
for (let i = 0; i < N; i++) {
  npcsData.push({
    name: `NPC ${i}`,
    region: 100,
    x: 0,
    y: 0,
    teleport: [{ region: 100, x: 10, y: 10, name: `Dest ${i}` }]
  });
}

let teleportsData = [];
for (let i = 0; i < N; i++) {
  teleportsData.push({
    name: `Teleport ${i}`,
    region: 100,
    x: 0,
    y: 0,
    type: i % 3 + 1,
    teleport: [{ region: 100, x: 10, y: 10, name: `Dest ${i}` }]
  });
}

function mockUpdateMarkersOld() {
  npcsData.forEach((npc) => {
    let show = true;
    if (show) {
      const showNPCTeleports = (document.getElementById('toggle-conn-7'))?.checked ?? false;
      if (true && showNPCTeleports && npc.teleport && Array.isArray(npc.teleport)) {
        npc.teleport.forEach((dest) => {
          let destRegion = dest.region;
        });
      }
    }
  });

  teleportsData.forEach((tp) => {
    let show = true;
    if (show) {
      const showConnections = (document.getElementById(`toggle-conn-${tp.type}`))?.checked ?? false;
      if (true && showConnections && tp.teleport && Array.isArray(tp.teleport)) {
        tp.teleport.forEach((dest) => {
          let destRegion = dest.region;
        });
      }
    }
  });
}

function mockUpdateMarkersNew() {
  const showNPCTeleports = (document.getElementById('toggle-conn-7'))?.checked ?? false;

  npcsData.forEach((npc) => {
    let show = true;
    if (show) {
      if (true && showNPCTeleports && npc.teleport && Array.isArray(npc.teleport)) {
        npc.teleport.forEach((dest) => {
          let destRegion = dest.region;
        });
      }
    }
  });

  const connectionCache = {};
  teleportsData.forEach((tp) => {
    let show = true;
    if (show) {
      let showConnections = connectionCache[tp.type];
      if (showConnections === undefined) {
        showConnections = (document.getElementById(`toggle-conn-${tp.type}`))?.checked ?? false;
        connectionCache[tp.type] = showConnections;
      }

      if (true && showConnections && tp.teleport && Array.isArray(tp.teleport)) {
        tp.teleport.forEach((dest) => {
          let destRegion = dest.region;
        });
      }
    }
  });
}

// Warmup
for(let i=0; i<10; i++) {
    mockUpdateMarkersOld();
    mockUpdateMarkersNew();
}

let start = performance.now();
for(let i=0; i<100; i++) {
    mockUpdateMarkersOld();
}
let end = performance.now();
console.log(`Old: ${(end - start).toFixed(2)} ms`);


start = performance.now();
for(let i=0; i<100; i++) {
    mockUpdateMarkersNew();
}
end = performance.now();
console.log(`New: ${(end - start).toFixed(2)} ms`);
