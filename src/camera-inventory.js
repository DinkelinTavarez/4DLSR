// Reserve existing identities before assigning newly discovered cameras. In
// particular, a disconnected early slot must never steal a later live feed.
export function assignCameraDevices(slots, devices) {
  const available = new Set(devices.map(d => d.deviceId));
  const used = new Set();
  const assignments = Array(slots.length).fill('');
  for (const active of [true, false]) {
    slots.forEach((slot, i) => {
      if (!!slot.active !== active || !slot.deviceId || used.has(slot.deviceId)) return;
      if (active || available.has(slot.deviceId)) {
        assignments[i] = slot.deviceId;
        used.add(slot.deviceId);
      }
    });
  }
  slots.forEach((slot, i) => {
    if (assignments[i] || slot.userUnassigned) return;
    const match = devices.find(d => !used.has(d.deviceId) && d.label === slot.label && d.occurrence === slot.occurrence)
      || devices.find(d => !used.has(d.deviceId));
    if (match) { assignments[i] = match.deviceId; used.add(match.deviceId); }
  });
  return assignments;
}
