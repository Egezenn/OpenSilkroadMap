const dbName = "OpenSilkroadMapPMTilesCache";
const storeName = "archives";
let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = (e) => reject(e);
        request.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
    });
    return dbPromise;
}

export const PMTilesDB = {
    async get(key: string): Promise<Blob | null> {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, "readonly");
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                request.onsuccess = (e) => {
                    resolve((e.target as IDBRequest).result || null);
                };
                request.onerror = (e) => reject(e);
            });
        } catch (e) {
            return null;
        }
    },

    async set(key: string, blob: Blob): Promise<void> {
        try {
            const db = await getDB();
            const transaction = db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            store.put(blob, key);
            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = (e) => reject(e);
            });
        } catch (e) {
            console.error("Failed to save archive to IndexedDB:", e);
        }
    },

    async has(key: string): Promise<boolean> {
        const blob = await this.get(key);
        return blob !== null;
    },
};

export class BlobSource {
    constructor(
        private key: string,
        private blob: Blob,
    ) {}

    async getBytes(offset: number, length: number) {
        const slice = this.blob.slice(offset, offset + length);
        const buffer = await slice.arrayBuffer();
        return { data: buffer };
    }

    getKey() {
        return this.key;
    }
}
