// Minimal promise wrapper around IndexedDB.

const DB_NAME = 'locale';
const DB_VERSION = 1;
let dbPromise = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const workouts = db.createObjectStore('workouts', { keyPath: 'id' });
    workouts.createIndex('startedAt', 'startedAt');
    workouts.createIndex('activity', 'activity');
    db.createObjectStore('tracks', { keyPath: 'workoutId' });
    db.createObjectStore('raw', { keyPath: 'workoutId' });
  }
}

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked'));
    });
  }
  return dbPromise;
}

const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Object.fromEntries([].concat(storeNames).map((n) => [n, t.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores, promisify))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        try {
          t.abort();
        } catch {
          /* already finished */
        }
        reject(err);
      });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
