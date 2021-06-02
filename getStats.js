/* eslint-disable */
const redis = require('redis');
const process = require('process');
const { factory } = require('typescript');
const fs = require('fs').promises;

const url = process.argv[2];

console.log('Will fetch stats from Redis');
const redisOptions = {};
const client = redis.createClient(url, redisOptions);
const TRADES_EVENTS = 'TRADES_EVENTS';
const FAILED_TRANSACTION = 'FAILED_TRANSACTION';
const SUCCESSFUL_TRANSACTION = 'SUCCESSFUL_TRANSACTION';
const CANCEL_TRANSACTION_SUCCESSFUL = 'CANCEL_TRANSACTION_SUCCESSFUL';
const CANCEL_TRANSACTION_FAILED = 'CANCEL_TRANSACTION_FAILED';

const failed = [];
const success = [];
const working = [];
const cancel = [];
const cancelFailed = [];
const failedToCheck = [];
const all = [];
const errorTypes = {};

async function getStats(cb) {
  const txEvents = await hgetall(TRADES_EVENTS);

  for (const txE in txEvents) {
    const e = JSON.parse(txEvents[txE]);
    all.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
    if (e.latestFeEvent.status === FAILED_TRANSACTION) {
      failed.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
    } else if (e.latestFeEvent.status === SUCCESSFUL_TRANSACTION) {
      success.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
    } else if (e.latestFeEvent.status === CANCEL_TRANSACTION_SUCCESSFUL) {
      cancel.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
    } else if (e.latestFeEvent.status === CANCEL_TRANSACTION_FAILED) {
      cancelFailed.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
      if (!findFinalStatus(e))
        console.log(
          'Final status not found for %o',
          e.transaction.serializedSwap
        );
    } else if (e.latestFeEvent.status.includes('FLASHBOTS RESULT')) {
      failedToCheck.push(
        getData(e.transaction.serializedSwap, e.latestFeEvent)
      );
      if (!findFinalStatus(e))
        console.log(
          'Final status not found for %o',
          e.transaction.serializedSwap
        );
    } else {
      working.push(getData(e.transaction.serializedSwap, e.latestFeEvent));
    }
  }

  const total = working.length + cancel.length + failed.length + success.length;
  const successRate = Math.floor(
    ((success.length + cancel.length) /
      (success.length + failed.length + cancel.length)) *
      100
  );

  console.log('--------------------------------');
  console.log('USAGE STATS');
  console.log('--------------------------------');
  console.log('WORKING: ' + working.length);
  console.log('CANCELED: ' + cancel.length);
  console.log('FAILED: ' + failed.length);
  console.log('SUCCESS: ' + success.length);
  console.log('TOTAL: ' + total);
  console.log('SUCCESS RATE: ' + successRate + ' %');
  console.log('\n--------------------------------');
  console.log('OPERATIONAL STATS (admins only)');
  console.log('--------------------------------');
  console.log('CANCELED FAILED: ' + cancelFailed.length);
  console.log('FAILED AND TO CHECK: ' + failedToCheck.length);

  // Save date to CSV files
  const errorTypesArray = [];
  for (let type in errorTypes) {
    errorTypesArray.push({ type: type, count: errorTypes[type] });
  }

  const saveToCsvMethods = [
    saveToCsv('failed', failed),
    saveToCsv('cancel', cancel),
    saveToCsv('cancelFailed', cancelFailed),
    saveToCsv('failedToCheck', failedToCheck),
    saveToCsv('success', success),
    saveToCsv('all', success),
    saveToCsv('rejectedByFlashbotsErrorTypes', errorTypesArray)
  ];
  await Promise.all(saveToCsvMethods);

  return cb();
}

const hgetall = (set) => {
  return new Promise((resolve, reject) => {
    client.hgetall(set, (err, reply) => {
      if (err) return reject(err);
      return resolve(reply);
    });
  });
};

const saveToCsv = async (filename, json) => {
  var fields = Object.keys(json[0]);
  // var fields = ['serializedSwap', 'status', 'message'];
  var replacer = function (key, value) {
    return value === null ? '' : value;
  };
  var csv = json.map(function (row) {
    return fields
      .map(function (fieldName) {
        return JSON.stringify(row[fieldName], replacer);
      })
      .join(',');
  });
  csv.unshift(fields.join(',')); // add header column
  csv = csv.join('\r\n');
  await fs.writeFile('./data/' + filename + '.csv', csv);
};

const getData = (serializedSwap, e) => {
  if (e.message && typeof e.message === 'string') {
    e.message = e.message.replace(/\\/g, '');

    if (e.message.includes('Rejected by flashbots:')) {
      const split = e.message.split('Rejected by flashbots:');
      e.message = JSON.parse(split[1]);
      if (
        e.message.bundleSubmissionSimulation &&
        e.message.bundleSubmissionSimulation.firstRevert &&
        e.message.bundleSubmissionSimulation.firstRevert.revert
      ) {
        e.message =
          e.message.bundleSubmissionSimulation.firstRevert.revert.replace(
            /u0000/g,
            ''
          );
        if (!errorTypes[e.message]) errorTypes[e.message] = 1;
        errorTypes[e.message]++;
      } else if (e.message.bundleSubmissionSimulation) {
        e.message = e.message.bundleSubmissionSimulation.error.message;

        if (e.message.includes('nonce too high')) e.message = 'nonce too high';
        else if (e.message.includes('nonce too low'))
          e.message = 'nonce too low';

        if (!errorTypes[e.message]) errorTypes[e.message] = 1;
        errorTypes[e.message]++;
      }
    }
  }
  return {
    serializedSwap: serializedSwap,
    status: e.status,
    message: e.message
  };
};

const findFinalStatus = (txEvents) => {
  let found = false;
  for (const e of txEvents.events) {
    if (e.status === FAILED_TRANSACTION) {
      failed.push(getData(txEvents.transaction.serializedSwap, e));
      found = true;
      break;
    } else if (e.status === SUCCESSFUL_TRANSACTION) {
      success.push(getData(txEvents.transaction.serializedSwap, e));
      found = true;
      break;
    } else if (e.status === CANCEL_TRANSACTION_SUCCESSFUL) {
      cancel.push(getData(txEvents.transaction.serializedSwap, e));
      found = true;
      break;
    } else if (e.status === CANCEL_TRANSACTION_FAILED) {
      cancelFailed.push(getData(txEvents.transaction.serializedSwap, e));
      found = true;
      break;
    }
  }
  return found;
};

getStats(() => {
  process.exit();
});
