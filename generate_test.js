function checkAndEmitDefaultJackpotHit(io) {
  console.log('Emitting default jackpotHit');
  let availableIds = [0, 1, 2, 3, 34, 80];
  let usedIds = [];
  // If all IDs have been used, reset availableIds
  if (availableIds.length === 0) {
    availableIds = usedIds;
    usedIds = [];
    console.log('Resetting ID pool:', availableIds);
  }
  // Randomly select an ID from availableIds
  const[randomIndex, selectedId] = getRandomId(availableIds)
  // Move selected ID to usedIds
  usedIds.push(selectedId);
  availableIds.splice(randomIndex, 1);
  console.log(`Selected ID: ${selectedId}, Remaining IDs: ${availableIds}`);
  io.emit('jackpotHit', {
    id: selectedId,
    name: "Frequent",
    amount: 300,
    machineNumber: "000",
    timestamp: new Date().toISOString()
  });
}

function getRandomId(availableIds){
  const randomIndex = Math.floor(Math.random() * availableIds.length);
  const selectedId = availableIds[randomIndex];
  return [randomIndex, selectedId]
}

// Export the function
module.exports = { checkAndEmitDefaultJackpotHit, getRandomId};
