/*!
 * HoldDB.js wrapper to IndexedDB
 * https://github.com/misamu/holddb.js
 *
 * Licence: MIT
 */

/**
 * @author Misa Munde
 * @version: 1.0
 *
 * Supported:
 * 	Chrome 48+
 * 	Firefox 45+
 */

/**
 * @typedef {IDBOpenDBRequest & {
 *		holdDBStoreName: string
 * }} holdDBIDBOpenDBRequest
 */

/**
 * @typedef {Event & {
 *		target: holdDBIDBOpenDBRequest
 * }} holdDBIDBOpenEvent
 */

/**
 * @typedef {IDBVersionChangeEvent & {
 *		target: holdDBIDBOpenDBRequest
 * }} holdDBIDBVersionChangeEvent
 */

/**
 * @typedef {EventTarget & {
 *		target: holdDBIDBOpenDBRequest
 * }} holdDBIDBOpenDBRequestError
 */

/**
 * @typedef {DOMException & {
 *		target: IDBRequest
 * }} IDBTransactionError
 */

/**
 * @typedef {{
 *		autoIncrement: boolean|undefined,
 *		indexes: Array.<{
  *			index: string,
  *			multiEntry: boolean,
  *			unique: boolean
  *		}>|undefined,
 *		keyPath: string|undefined
 * }} holdDBObjectStoreSchema
 */

/**
 * @typedef {{
 *		unique: boolean,
 *		objects: Object.<holdDBObjectStoreSchema>,
 *		reset: number|undefined
 * }} holdDBDatabaseSchema
 */

/**
 * @typedef {{
 *		db: string,
 *		message: string,
 *		name: string,
 *		storage: string
 * }} holdDBException
 */

/**
 * indexedDB storage handler
 */
(function(window) {
	const version = 1.00;

	const LOG_DEBUG = 0;
	const LOG_WARN = 1;
	const LOG_ERROR = 2;

	const DB_HOLD = 'holdDB';
	const OBJECT_HOLD_DATABASES = 'databases';

	/**
	 * Has holdDB been initialized
	 * @type {boolean}
	 */
	let initialized = false;

	/**
	 * Databases initialized
	 * @type {Map<string, number>}
	 */
	const initializedDatabases = new Map();

	/**
	 * Databases initialized
	 * @type {Map<string, Array<{
	 *     object: string,
	 *     resolve: Function,
	 *     reject: Function
	 * }>>}
	 */
	const waitDatabase = new Map();

	/**
	 * holdDB Initialized promises
	 * @type {Array<Function>}
	 */
	const initPromises = [];

	/**
	 * Opened databases cached
	 * @type {Map<string, IDBDatabase>}
	 */
	const databaseCache = new Map();

	/**
	 * If ObjectStore has unique set as true then setUnique has to be set beforehand to enable postfix ObjectStore name
	 * @see db.setUnique
	 * @type {number|string}
	 */
	let objectStoreUnique;

	/**
	 * Is this browser supported?
	 * @type {boolean}
	 */
	let supported = true;

	/**
	 * Convenience for READ_WRITE
	 * @type {IDBTransactionMode}
	 */
	const RW = 'readwrite';

	/**
	 * Convenience for READ_ONLY
	 * @type {IDBTransactionMode}
	 */
	const R = 'readonly';

	/**
	 * Object that will be visible to outside
	 */
	const db = Object.create(null);

	const IDBCursorDirection = {
		"next": "next",
		"nextReverse": "nextReverse",
		"nextunique": "nextunique",
		"prev": "prev",
		"prevReverse": "prevReverse",
		"prevunique": "prevunique"
	};

	/**
	 * Database schemas and what kind of ObjectStores it can hold
	 * @see holdDBObjectStoreSchema
	 * @type {Object}
	 */
	const schemas = {
		/**
		 * Internal database to hold all registered databases
		 */
		holdDB: {
			objects: {
				databases: {}
			}
		}
	};

	/**
	 * Logging system that can be overridden
	 * @type {{debug: Function, warn: Function, error: Function, submit: Function|null}}
	 */
	const log = {
		debug: console.log,
		warn: console.warn,
		error: console.error,
		submit: function() {}
	};

	/**
	 * Write debug
	 * @param {string} message
	 * @param {number} [errorLevel=LOG_DEBUG]
	 */
	function consoleMessage(message, errorLevel) {
		errorLevel = errorLevel || LOG_DEBUG;

		switch (errorLevel) {
			case LOG_DEBUG:
				log.debug(`holdDB.js:`, message);
				break;

			case LOG_WARN:
				log.warn(`holdDB.js:`, message);
				break;

			case LOG_ERROR:
				log.error(`holdDB.js:`, message);

				// Call submit in error case
				log.submit(`HoldDB.js error`);
				break;
		}
	}

	function consoleError(message) {
		consoleMessage(message, LOG_ERROR);
	}

	/**
	 * openDB thrown error
	 * @param {holdDBException} error
	 */
	function openDBThrownError(error) {
		if (error.db) {
			const target = (error.storage) ? `${error.db}::${error.storage}` : error.db;

			consoleMessage(`[${target}] openDB fatal error [${error.name} / ${error.message}]`, LOG_ERROR);

		} else {
			consoleMessage(`openDB fatal error [${error.name} / ${error.message}]`, LOG_ERROR);
		}
	}

	/**
	 * Validate that database and ObjectStore names are good
	 * @param {string} dbName
	 * @param {string} objectName
	 * @returns {string}
	 */
	function openDBHandleValidate(dbName, objectName) {
		const dbData = schemas[dbName];

		if (dbName !== DB_HOLD) {
			// Make sure holdDB has been initialized
			if (initialized === false) {
				throw new Error(`holdDB.js::openDB has not been initialized [${dbName}::${objectName}]`);
			}

			// Check that database has been initialized
			if (dbData === undefined) {
				throw new Error(`holdDB.js::openDB - [${dbName}] database has not been defined`);
			}

			// Make sure that objectStore has been initialized if given
			if (objectName !== undefined && dbData.objects[objectName] === undefined) {
				throw new Error(`holdDB.js::openDB - [${dbName}::${objectName}] objectStore has not initialized`);
			}

			if (dbData.unique) {
				if (objectStoreUnique !== undefined) {
					dbName = `${dbName}-${objectStoreUnique}`;
					schemas[dbName] = dbData;

				} else {
					throw new Error(`holdDB.js::openDB - [${dbName}] is unique, but setUnique not set`);
				}
			}
		}

		return dbName;
	}

	/**
	 * Open database
	 * @param {string} dbName
	 * @param {string} [objectName]
	 * @returns {Promise<IDBDatabase>}
	 */
	function openDB(dbName, objectName) {
		// Validation parses correct suffixed database name if required and this should be done only once thus
		// call it here in openDB that should be only access point to database for client to use
		dbName = openDBHandleValidate(dbName, objectName);

		// Bind dbName and objectName for function and promise then adds resolve reject functions
		return new Promise(openDBHandle.bind(null, dbName, objectName));
	}

	/**
	 * Set database initialized to holdDB table
	 * @param {string} database
	 */
	function initializedDatabase(database) {
		// HoldDB internal table is not handled in this set
		if (database !== DB_HOLD && !initializedDatabases.has(database)) {
			consoleMessage(`[${database}] Initialized database`, LOG_DEBUG);

			// Set database initialized because it clearly exists
			initializedDatabases.set(database, Date.now());

			// Write new object store to general db objectStore
			openDB(DB_HOLD, OBJECT_HOLD_DATABASES).then(function (idb) {
				const tx = idb.transaction(OBJECT_HOLD_DATABASES, RW);
				const storeList = tx.objectStore(OBJECT_HOLD_DATABASES);

				storeList.put({
					key: database,
					created: Date.now()
				}, database);
			}).catch(openDBThrownError);
		}
	}

	/**
	 * Create objectStore for this IDBDatabase
	 * @private
	 * @param {IDBDatabase} database
	 * @param {string} objectName
	 */
	function createObjectStore(database, objectName) {
		/**
		 * @type {holdDBDatabaseSchema}
		 */
		const objectData = schemas[database.name];

		/**
		 * @type {holdDBObjectStoreSchema}
		 */
		const storeSchema = objectData.objects[objectName];

		const createOptions = {};

		// If objectStore already exists then don't do anything
		if(!database.objectStoreNames.contains(objectName)) {
			consoleMessage(`[${database.name}::${objectName}] Create ObjectStore`, LOG_DEBUG);

			// objectStore has not been defined so it can not be created
			if (storeSchema === undefined) {
				throw new Error(`holdDB.js::createObjectStore [${database.name}::${objectName}] has not been initialized`);
			}

			// Add key path if exists
			if (storeSchema.keyPath) {
				createOptions.keyPath = storeSchema.keyPath;
			}

			// Add autoIncrement if exists
			if (storeSchema.autoIncrement === true) {
				createOptions.autoIncrement = true;
			}

			// Creating a new DB store with a specified key property
			const store = database.createObjectStore(objectName, createOptions);

			// Create indexes
			if (Array.isArray(storeSchema.indexes)) {
				storeSchema.indexes.forEach(function(data) {
					if (data.index === undefined) {
						throw new Error(`holdDB.js::createObjectStore [${database.name}::${objectName}] Index missing index type`);
					}

					store.createIndex(`idx_${data.index}`, data.index, {
						unique: data.unique || false,
						multiEntry: data.multiEntry || false
					});
				});
			}
		}
	}

	/**
	 * IndexedDB database onVersionChange event
	 * @param event
	 */
	function idbOnVersionChange(event) {
		const database = event.target.name;

		consoleMessage(`[${database}] onVersionChange`, LOG_DEBUG);

		if (databaseCache.has(database) && databaseCache.get(database) !== event.target) {
			databaseCache.get(database).close();
		}

		event.target.close();

		databaseCache.delete(database);
	}

	/**
	 * IDBOpenDBRequest onAbort
	 * @param {holdDBIDBOpenDBRequestError} e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestAbort(e) {
		const dbName = e.target.holdDBStoreName;

		consoleMessage(`[${dbName}] onAbort`, LOG_DEBUG);

		if (databaseCache.has(dbName)) {
			databaseCache.get(dbName).close();
			databaseCache.delete(dbName);
		}

		waitDatabase.delete(dbName);
	}

	/**
	 * IDBOpenDBRequest onBlocked
	 * @param {holdDBIDBOpenDBRequestError} e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestBlocked(e) {
		consoleMessage(`[${e.target.holdDBStoreName}] onBlocked`, LOG_DEBUG);
	}

	/**
	 * IDBOpenDBRequest onSuccess
	 * @param {holdDBIDBOpenEvent} e
	 */
	function idbOpenDBRequestSuccess(e) {
		const target = e.target,
				database = target.result,
				dbName = database.name;

		// On version change listener to close current cached database because new version is coming
		database.onversionchange = idbOnVersionChange;

		// Make sure that holdDB::databases has this objectStore defined and if not then take required action
		if (dbName !== DB_HOLD && !initializedDatabases.has(dbName)) {
			// If reset requested and this database has not been just created then do reset
			if (database.version !== 1 && schemas[dbName].reset !== undefined) {
				consoleMessage(`[${dbName}] Database not initialized and reset defined`, LOG_DEBUG);

				db.deleteDB(dbName).then(function() {
					openDBHandle(dbName);
				});

				return;
			}

			// Mark database as initialized
			initializedDatabase(dbName);
		}

		// Cache the open connection - requires to be before create non-existing objectStore to create new version
		databaseCache.set(dbName, database);

		// Check all cached items if object store has not been created and required creation
		// objectStore does not exist so create and that will trigger onUpgradeNeeded that will handle caching etc
		const objectMissing = waitDatabase.get(dbName).some(data => {
			// objectStore does not exist so create and that will trigger onUpgradeNeeded that will handle caching etc
			if (data.object !== undefined && database.objectStoreNames.contains(data.object) === false) {
				consoleMessage(`[${dbName}::${data.object}] ObjectStore not found - create`, LOG_DEBUG);
				openDBHandle(dbName, data.object);
				return true;
			}

			return false;
		});

		// All required object stores exist - trigger promises
		if (!objectMissing) {
			consoleMessage(`[${dbName}] Opened`, LOG_DEBUG);

			waitDatabase.get(dbName).forEach(data => {
				data.resolve(database);
			});

			// All waiting requests handled
			waitDatabase.delete(dbName);
		}
	}

	/**
	 * IDBOpenDBRequest onUpgradeNeeded
	 * Triggers every time there is need to change database schema including when creating database
	 * @param {holdDBIDBVersionChangeEvent} e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestUpgrade(e) {
		const database = e.target.result,
				dbName = database.name;

		e.target.transaction.onerror = consoleError;
		consoleMessage(`[${dbName}] onUpgradeNeeded`, LOG_DEBUG);

		waitDatabase.get(dbName).forEach(data => {
			if (data.object !== undefined) {
				createObjectStore(database, data.object);
			}
		});

		// Mark database as initialized
		initializedDatabase(dbName);
	}

	/**
	 * IDBOpenDBRequest error
	 * @param {holdDBIDBOpenDBRequestError} e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestError(e) {
		const error = e.target.error,
				dbName = e.target.holdDBStoreName;

		if (error.name === "VersionError") {
			consoleMessage(`[${dbName}] VersionError delete and recreate`, LOG_DEBUG);

			// VersionError for some reason - delete database and trigger again opening of this database
			db.deleteDB(dbName).then(function() {
				openDBHandle(dbName);
			});
			return true;
		}

		if (error.name === "UnknownError") {
			consoleMessage(`[${dbName}] openDB UnknownError [Code: ${error.code}] [Message: ${error.message}]`, LOG_DEBUG);
			// Call submit in error case
			log.submit(`HoldDB.js Unknown error`);

			if (error.code === 0) {
				if (document.location.pathname.indexOf('469') === -1) {
					// For now indexedDB is required
					document.location = '/469';
				}

			} else {
				// UnknownError - at least FF gave this if DB created with newer version and then opened with older
				db.deleteDB(dbName).then(function() {
					consoleMessage(`[${dbName}] UnknownError database has been deleted`, LOG_DEBUG);
					waitDatabase.get(dbName).forEach(data => {
						data.reject({
							'db': dbName,
							'storage': data.object,
							'name': error.name,
							'message': error.message
						});
					});
				});
			}

			return true;
		}

		if (error.name === "InvalidStateError") {
			if (document.location.pathname.indexOf('469') === -1) {
				consoleMessage(`IndexedDB not supported`, LOG_DEBUG);
				// For now indexedDB is required
				document.location = '/469';
			}
			// storage not supported
			supported = false;
		}

		waitDatabase.get(dbName).forEach(data => {
			data.reject({
				'db': dbName,
				'storage': data.object,
				'name': error.name,
				'message': error.message
			});
		});

		// Suppress error escalating
		return true;
	}

	/**
	 * openDB handler
	 * @private
	 * @param {string} dbName
	 * @param {string} [objectName]
	 * @param {Function} [resolve]
	 * @param {Function} [reject]
	 */
	function openDBHandle(dbName, objectName, resolve = undefined, reject = undefined) { // jshint ignore:line
		let request;

		// If promise return functions exists and open is already triggered then add callbacks just to waiting queue
		if (resolve && reject) {
			if (waitDatabase.has(dbName)) {
				const resolves = waitDatabase.get(dbName);
				resolves.push({
					'object': objectName,
					'resolve': resolve,
					'reject': reject
				});
				return;
			}
		}

		// Database already open and object storeStore requested
		if (databaseCache.has(dbName) && objectName !== undefined) {
			// Database has requested ObjectStore already opened
			const targetDB = databaseCache.get(dbName);

			// If resolve and reject are defined thus first call to open and store name found then can return
			if (resolve) {
				if (targetDB.objectStoreNames.contains(objectName) !== false) {
					resolve(targetDB);
					return;
				}
			}

			consoleMessage(`[${dbName}::${objectName}] openDBHandle new [Version: ${targetDB.version + 1}]`, LOG_DEBUG);

			// Requested ObjectStorage is not open so open new version of database and initialize ObjectStore
			request = window.indexedDB.open(dbName, targetDB.version + 1);

		} else {
			// Open the requested database with latest version
			request = window.indexedDB.open(dbName);
		}

		// Bind requested database and objectStore name to IDBOpenDBRequest
		// This in bound only when resolve and reject are set -- internal calls don't set these
		if (resolve && reject) {
			let resolves = [];
			if (waitDatabase.has(dbName)) {
				resolves = waitDatabase.get(dbName);
			} else {
				waitDatabase.set(dbName, resolves);
			}
			resolves.push({
				'object': objectName,
				'resolve': resolve,
				'reject': reject
			});
		}

		// Store dbName to object for error cases
		request.holdDBStoreName = dbName;

		// IDB connection aborted
		request.onabort = idbOpenDBRequestAbort;

		// IDB blocked
		request.onblocked = idbOpenDBRequestBlocked;

		// IDB failure
		request.onerror = idbOpenDBRequestError;

		// IDB open success
		request.onsuccess = idbOpenDBRequestSuccess;

		// Handle onUpgradeNeeded
		request.onupgradeneeded = idbOpenDBRequestUpgrade;
	}

	/**
	 * IDBTransaction error
	 * @param {IDBTransaction} transaction
	 * @param {IDBRequest} event
	 * @param {function(holdDBException)} reject
	 * @param {string} message
	 * @param {number} [consoleLogLevel=LOG_ERROR]
	 */
	function transactionError(transaction, event, reject, message, consoleLogLevel = LOG_ERROR) {
		const error = event.error;

		let database = (transaction.objectStoreNames.length > 0) ?
				`${transaction.db.name}::${transaction.objectStoreNames[0]}` : `${transaction.db.name}`;

		// Log these to server so could try to figure out how to fix like multiAdd where constraint error was the reason
		consoleMessage(`${message} [${database}] [${error.name} / ${error.message}]`, consoleLogLevel);

		reject({
			'db': transaction.db.name,
			'storage': (transaction.objectStoreNames.length > 0) ? transaction.objectStoreNames[0] : '',
			'name': error.name,
			'message': error.message
		});
	}

	/**
	 * Get requested keys from the objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<number|string>} keys
	 * @param {string|boolean} [index]
	 * @param {boolean} [asObject]
	 * @return {Promise<Array>}
	 */
	function getKeysHandler(database, object, keys, index = undefined, asObject = false) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);
				const items = [];

				// Transaction completed
				tx.oncomplete = function() {
					resolve(items);
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getKeys transaction error`);
				};

				const objectStore = (index !== undefined) ? tx.objectStore(object).index(`idx_${index}`) : tx.objectStore(object);
				const cursorRequest = objectStore.openCursor(null, "next");

				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					if (cursor) {
						const key = (index) ? cursor.key : cursor.primaryKey;

						if (keys.indexOf(key) !== -1) {
							items.push(asObject ? {key: key, value: cursor.value} : cursor.value);
						}

						cursor.continue();
					}
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getKeys error`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: error.name,
						message: error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	}


	/**
	 * Update key database or insert if not existing and put was requested
	 * @notice this function takes key value pair to update object or just key to be inserted or function to callback changes
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|array<string>} key
	 * @param {*} [value]
	 * @param {boolean} [insert=false]
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Object>}
	 */
	function updateHandler(database, object, key, value, insert = false, asObject = false) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, RW);
				const db = schemas[idb.name] || {};
				const objectData = db.objects[object] || false;

				if (objectData === false) {
					consoleMessage(`[${idb.name}::${object}] Update object or virtual not defined`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': `IDBUpdate`,
						'message': `Update object or virtual not defined`
					});
					return;
				}

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `update transaction error`);
				};

				const store = tx.objectStore(object);
				const cursorRequest = store.openCursor(window.IDBKeyRange.only(key));

				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					let	storeData;

					if (cursor) {
						storeData = (typeof value === 'function') ? value(cursor.value) : value;
						cursor.update(storeData);

					} else if (insert === true) {
						storeData = (typeof value === 'function') ? value(null) : value;
						store.put(storeData, key);

					} else {
						reject({
							'db': database,
							'storage': object,
							'name': `IDBUpdate`,
							'message': `Requested key does not exist`
						});
						return;
					}

					resolve(asObject ? {key: cursor.primaryKey || key, value: storeData} : storeData);
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] Update error [Key: ${key}] [Error: ${error.message}]`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	}

	db.getVersion = function () {
		return version;
	};

	/**
	 * If unique has been defined to objectStore schema then second parameter is required to postfix objectStore name
	 * @param {string|number} key
	 */
	db.setUnique = function(key) {
		consoleMessage(`setUnique [${key}]`, LOG_DEBUG);
		objectStoreUnique = key;
		delete db.setUnique;
	};

	/**
	 * When DB has been initialized
	 * @return Promise
	 */
	db.hasInitialized = function() {
		return new Promise(function(resolve) {
			if (initialized) {
				resolve();

			} else {
				initPromises.push(resolve);
			}
		});
	};

	db.shouldReset = function(database, stamp) {
		const objectData = schemas[database.split("-")[0]];

		// objectStore exists - check if reset is requested
		if (objectData !== undefined) {
			return (objectData.reset !== undefined && objectData.reset > stamp);
		}

		// objectStore exists in database but not in defined objectStores - something legacy? delete.
		consoleMessage(`[${database}] shouldReset - Legacy delete`, LOG_DEBUG);
		db.deleteDB(database);
		return false;
	};

	/**
	 * Returns list of databases currently initialized
	 * @return {Map<string, number>}
	 */
	db.getDatabases = function() {
		return new Map(initializedDatabases);
	};

	/**
	 * Initialize new ObjectStore to given database
	 * @param {Object|string} database
	 * @param {string} database.name
	 * @param {number} [database.reset]
	 * @param {boolean} [database.unique]
	 * @param {Object.<holdDBObjectStoreSchema>|string} [schema]
	 */
	db.initDatabase = function(database, schema) {
		let dbName;

		if (typeof database === "string") {
			dbName = database;

		} else {
			// Check that database name exists
			if (typeof database.name !== "string") {
				consoleMessage(`initDatabase database name is not defined`, LOG_ERROR);
				return false;
			}

			dbName = database.name;
		}

		// Check that database has not been initialized yet
		if (schemas[dbName] !== undefined) {
			consoleMessage(`[${database}] initDatabase has been initialized already`, LOG_ERROR);
			return false;
		}

		schemas[dbName] = (typeof database === 'object') ? database : {};
		schemas[dbName].objects = {};

		// Init ObjectStorage
		if (typeof schema === 'string') {
			schemas[dbName].objects[schema] = {};

		} else {
			schemas[dbName].objects = schema || {};
		}

		return true;
	};

	/**
	 * Initialize new ObjectStore to given database
	 * @param {string} database
	 * @param {string} objectStore
	 * @param {holdDBObjectStoreSchema} [schema]
	 */
	db.initObjectStore = function(database, objectStore, schema) {
		const objectData = schemas[database];

		// Check that database has been initialized where this new ObjectStore goes to
		if (objectData === undefined) {
			consoleMessage(`[${database}::${objectStore}] initObjectStore database does not exist`, LOG_ERROR);
			return false;
		}

		objectData.objects[objectStore] = schema || {};
		return true;
	};

	/**
	 * Count keys in given objectStore
	 * @param {string} database
	 * @param {string} object
	 * @return {Promise<number>}
	 */
	db.count = function(database, object) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `has transaction error`);
				};

				const store = tx.objectStore(object);

				const countRequest = store.count();

				countRequest.onsuccess = function() {
					resolve(this.result);
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Delete all databases
	 * @param {Array} databases
	 */
	db.deleteDatabases = function(databases) {
		return new Promise(async (resolve) => {
			const databaseCount = databases.length;
			const deleted = [];

			// Log that deleteAllDatabases has been called
			consoleMessage(`DeleteDatabases`, LOG_DEBUG);

			for (let x = 0; x < databaseCount; x++) {
				try {
					// Delete the database
					await db.deleteDB(databases[x]);
					deleted.push(databases[x]);

				} catch (error) {
					consoleError(`DeleteDatabases error: ${error}`);
				}
			}

			resolve(deleted);
		});
	};

	/**
	 * Delete database
	 * @param {string} dbName
	 */
	db.deleteDB = function(dbName) {
		return new Promise(function(resolve, reject) {
			consoleMessage(`[${dbName}] Request delete`, LOG_DEBUG);

			if (databaseCache.has(dbName)) {
				databaseCache.get(dbName).close();
				databaseCache.delete(dbName);
			}

			//Opening the DB
			const request = window.indexedDB.deleteDatabase(dbName);

			// IDB delete success
			request.onsuccess = function() {
				consoleMessage(`[${dbName}] Deleted`, LOG_DEBUG);

				// Delete database from tracking if is not DB_HOLD
				if (dbName !== DB_HOLD) {
					db.delete(DB_HOLD, OBJECT_HOLD_DATABASES, dbName).then(function() {
						resolve(true);
					});
				} else {
					resolve(true);
				}
			};

			// IDB delete failure
			request.onerror = function() {
				consoleMessage(`[${dbName}] deleteDB error [Error: ${this.error.name}]`, LOG_ERROR);
				reject({
					'db': dbName,
					'name': this.error.name,
					'message': this.error.message
				});
			};
		});
	};

	/**
	 * Delete database objectStore
	 * @param {string} database
	 * @param {string} storeName
	 * @returns {Promise}
	 */
	db.deleteObjectStore = function(database, storeName) {
		return new Promise(function(resolve, reject) {
			db.getDatabaseObjectStores(database).then(function(/*Array*/objectStores) {
				if (objectStores.indexOf(storeName) !== -1) {
					openDB(database, storeName).then(function(idb) {
						const request = window.indexedDB.open(idb.name, databaseCache.get(idb.name).version + 1);

						// Handle onUpgradeNeeded
						request.onupgradeneeded = function() {
							// Delete requested Object
							request.result.deleteObjectStore(storeName);
						};

						// IDB open success
						request.onsuccess = function() {
							consoleMessage(`[${database}::${storeName}] removed object`, LOG_DEBUG);
							resolve();
						};

						// IDB failure
						request.onerror = function(event) {
							// Log error
							consoleMessage(`[${database}::${storeName}] deleteObject error`, LOG_ERROR);

							event.preventDefault();
							reject();
						};
					}).catch(error => {
						openDBThrownError(error);
						reject(error);
					});

				} else {
					consoleMessage(`[${database}::${storeName}] delete ObjectStore does not exist`, LOG_DEBUG);
					resolve();
				}
			}).catch(function(error) {
				// Log these to server so could try to figure out how to fix like multiAdd where constraint error was the reason
				consoleMessage(`[${database}::${storeName}] [Error: ${error.name}] ${error.message}`, LOG_ERROR);
				reject(error);
			});
		});
	};

	/**
	 * Has key in database
	 * @param {string} database
	 * @param {string} object
	 * @param {string|Array} key
	 * @param {string} [index]
	 * @return {Promise<boolean>}
	 */
	db.has = function(database, object, key, index = undefined) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `has transaction error`);
				};

				const store = (index === undefined) ? tx.objectStore(object) : tx.objectStore(object).index(`idx_${index}`);

				const req = store.openKeyCursor(window.IDBKeyRange.only(key));
				req.onsuccess = function() {
					// key already exist
					if (this.result) {
						resolve(true);
					} else {
						resolve(false);
					}
				};
			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Does given objectStorage exist in given database?
	 * @param {string} database
	 * @param {string} objectName
	 * @return {Promise}
	 */
	db.hasObjectStore = function(database, objectName) {
		return new Promise(function(resolve, reject) {
			openDB(database).then(function(idb) {
				resolve(idb.objectStoreNames.contains(objectName));

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Add data to database
	 * This is a insert only function. For insert or update see put function
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|Object} key
	 * @param {string|Object} [value]
	 * @return {Promise<*>}
	 */
	db.add = function(database, object, key, value) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, RW);
				const objectData = schemas[idb.name].objects[object] || false;
				let request;

				// Transaction completed
				tx.oncomplete = function() {
					// Returns key used to insert the data like KeyPath or autoIncrement
					resolve(request.result);
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					if (event.target.error.name === "ConstraintError") {
						transactionError(this, event.target, reject, `holdDB::add`, LOG_WARN);

					} else {
						transactionError(this, event.target, reject, `holdDB::add`);
					}
				};

				// Get the object store
				const store = tx.objectStore(object);

				if (objectData.autoIncrement || objectData.keyPath) {
					request = store.add(key);

				} else {
					request = store.add(value, /**@type {IDBValidKey}*/(key));
				}
			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Add multiple items of data to database
	 * This is a insert only function. For insert or update see put function
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<{key:string, value:*}>|Object} items
	 * @return {Promise<{items:number, error: number}>}
	 */
	db.addMulti = function(database, object, items) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, RW);
				const db = schemas[idb.name] || {};
				const objectData = db.objects[object] || false;
				let error = 0;

				// Transaction completed
				tx.oncomplete = function() {
					resolve({
						items: items.length,
						error: error
					});
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					error++;

					// add throws ConstraintError if mutation does not work for example because of index
					if (event.target.error.name === 'ConstraintError') {
						event.target.preventDefault();

					} else {
						transactionError(this, event.target, reject, `addMulti transaction error`);
					}
				};

				// Get the object store
				const store = tx.objectStore(object);

				for (let x = 0; x < items.length; x++) {
					if (objectData.autoIncrement || objectData.keyPath) {
						store.add(items[x]);

					} else {
						store.add(items[x].value, items[x].key);
					}
				}
			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Put data to database
	 * This is insert or update function. See add for insert only function
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|Object} key
	 * @param {string|Object} [value]
	 * @return {Promise<boolean>}
	 */
	db.put = function(database, object, key, value) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, RW);
				const db = schemas[idb.name] || {};
				const objectData = db.objects[object] || false;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(true);
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `put transaction error`);
				};

				// Get the object store
				const store = tx.objectStore(object);

				if (objectData.autoIncrement || objectData.keyPath) {
					store.put(key);

				} else {
					store.put(value, /**@type {IDBValidKey}*/(key));
				}

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get data by index from database
	 * @param {string} database
	 * @param {string} object
	 * @param {string} index
	 * @param {string|number|null} [value=null]
	 * @return {Promise<Array<*>>}
	 */
	db.getByIndex = function(database, object, index, value = null) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getByIndex transaction error`);
				};

				const request = tx.objectStore(object).index(`idx_${index}`).getAll(value);

				request.onsuccess = function() {
					resolve(this.result);
				};

				request.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getByIndex error`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: error.name,
						message: error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get requested items from database
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number} key
	 * @return {Promise<*>}
	 */
	db.get = function(database, object, key) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `get transaction error`);
				};

				const request = tx.objectStore(object).get(key);

				request.onsuccess = function() {
					resolve(this.result);
				};

				request.onerror = function(error) {
					consoleMessage(`[${database}::${object}] [Key: ${key}] get error`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: error.name,
						message: error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get all the data from database
	 * @param {string} database
	 * @param {string} object
	 * @param {IDBValidKey|IDBKeyRange} [keyRange]
	 * @param {number} [limit]
	 * @return {Promise<Array<*>>}
	 */
	db.getAll = function(database, object, keyRange, limit) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getAll transaction error`);
				};

				const request = tx.objectStore(object).getAll(keyRange || null, limit || null);

				request.onsuccess = function() {
					resolve(this.result);
				};

				request.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getAll error`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: error.name,
						message: error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get single item
	 * @param {string} database
	 * @param {string} object
	 * @return {Promise<{key: string|number, value: *}>}
	 */
	db.getAny = function(database, object) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				let result;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(result);
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getAny transaction error`);
				};

				let cursorRequest = tx.objectStore(object).openCursor(null, IDBCursorDirection.next);
				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					if (cursor) {
						result = {
							key: cursor.key,
							value: cursor.value
						};
					}
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getAny error`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get all objectStore of given database
	 * @param {string} database
	 * @return {Promise<Array<string>>}
	 */
	db.getDatabaseObjectStores = function(database) {
		return new Promise(function(resolve, reject) {
			openDB(database).then(function(database) {
				const names = database.objectStoreNames;
				const keys = Object.keys(names);
				const objects = [];

				for (let x = 0; x < keys.length; x++) {
					objects.push(names[x]);
				}

				resolve(objects);

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};


	/**
	 * Get all database names in the system
	 * @return {Promise<Array<*>>}
	 */
	db.getDatabaseNames = function() {
		return new Promise(function(resolve) {
			db.getAll(DB_HOLD, OBJECT_HOLD_DATABASES).then(function(result) {
				resolve(result);
			});
		});
	};

	/**
	 * Get requested keys from the objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {string} [index]
	 * @return {Promise<Array<string>>}
	 */
	db.getAllKeys = function(database, object, index = undefined) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getAllKeys transaction error`);
				};

				const objectStore = tx.objectStore(object);
				const request = (index) ? objectStore.index(`idx_${index}`).getAllKeys() : objectStore.getAllKeys();
				request.onsuccess = function() {
					// key already exist
					if (this.result) {
						resolve(this.result);
					} else {
						resolve(false);
					}
				};

				request.onerror = function() {
					consoleMessage(`[${database}::${object}] getAllKeys error`, LOG_ERROR);
				};
			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get data by cursor
	 * @param {string} database
	 * @param {string} object
	 * @param {IDBValidKey|IDBKeyRange} [range]
	 * @param {IDBCursorDirection} [direction]
	 * @param {number} [limit]
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Array>}
	 */
	db.getCursor = function(database, object, range, direction, limit, asObject = false) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);
				const result = [];
				let x = 0;
				let reverse;
				let cursorRequest;

				if (direction === IDBCursorDirection.nextReverse) {
					direction = IDBCursorDirection.next;
					reverse = true;
				} else if (direction === IDBCursorDirection.prevReverse) {
					direction = IDBCursorDirection.prev;
					reverse = true;
				}

				// Transaction completed
				tx.oncomplete = function() {
					resolve(result);
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getCursor transaction error`);
				};

				cursorRequest = tx.objectStore(object).openCursor(range || null, direction || IDBCursorDirection.next);

				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					if (cursor && (limit === undefined || x < limit)) {
						if (reverse) {
							result.unshift(asObject ? {key: cursor.primaryKey, value: cursor.value} : cursor.value);
						} else {
							result.push(asObject ? {key: cursor.primaryKey, value: cursor.value} : cursor.value);
						}

						x++;
						cursor.continue();
					}
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getCursor error`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Get requested keys from the objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<number|string>} keys
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Array>}
	 */
	db.getKeys = function(database, object, keys, asObject) {
		return getKeysHandler(database, object, keys, undefined, asObject);
	};

	/**
	 * Get requested keys from the objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<number|string>} keys
	 * @param {string} index
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Array>}
	 */
	db.getKeysByIndex = function(database, object, keys, index, asObject) {
		return getKeysHandler(database, object, keys, index, asObject);
	};

	/**
	 * Get max primary key for object store
	 * If there are no items then undefined returned
	 * @param {string} database
	 * @param {string} object
	 * @return {Promise<number>}
	 */
	db.getMaxPrimaryKey = function(database, object) {
		return db.getMaxKey(database, object);
	};

	/**
	 * Get max primary key for object store
	 * If there are no items then undefined returned
	 * @param {string} database
	 * @param {string} object
	 * @param {string} [index]
	 * @return {Promise<*>}
	 */
	db.getMaxKey = function(database, object, index = undefined) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `getKeys transaction error`);
				};

				let objectStore = tx.objectStore(object);
				if (index !== undefined) {
					objectStore = objectStore.index(`idx_${index}`);
				}

				const cursorRequest = objectStore.openKeyCursor(null, 'prev');
				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					// Check that there is returned item or else return undefined
					if (cursor) {
						// If index is defined then return key else return primaryKey
						resolve((index !== undefined) ? cursor.key : cursor.primaryKey);

					} else {
						resolve(undefined);
					}
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] getMaxPrimaryKey error`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: error.name,
						message: error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Cursor iterating through elements
	 * @param {string} database
	 * @param {string} object
	 * @param {Function} handler
	 * @param {IDBKeyRange} [range]
	 * @param {IDBCursorDirection} [direction]
	 * @return {Promise<void>}
	 */
	db.cursorWalk = function(database, object, handler, range, direction) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, R);

				// Transaction completed
				tx.oncomplete = function() {
					resolve();
				};

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `cursorWalk transaction error`);
				};

				const cursorRequest = tx.objectStore(object).openCursor(
						range || null, direction || IDBCursorDirection.next);

				cursorRequest.onsuccess = function() {
					const cursor = this.result;

					if (cursor) {
						handler(cursor.value);
						cursor.continue();
					}
				};

				cursorRequest.onerror = function(error) {
					consoleMessage(`[${database}::${object}] cursorWalk error`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Delete key from objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {string|Array|Set} index
	 * @return {Promise<number>}
	 */
	db.delete = function(database, object, index) {
		return new Promise(function(resolve, reject) {
			openDB(database, object).then(function(idb) {
				const tx = idb.transaction(object, RW);
				const db = schemas[idb.name] || {};
				const objectData = db.objects[object] || false;
				let cursorRequest;

				if (objectData === false) {
					consoleMessage(`[${database}::${object}] Delete object or virtual not defined`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: `IDBDelete`,
						message: `Delete object or virtual not defined`
					});
					return;
				}

				// Transaction error
				tx.onerror = function(/*IDBTransactionError*/event) {
					transactionError(this, event.target, reject, `delete transaction error`);
				};

				const store = tx.objectStore(object);

				if (index instanceof Set) {
					let count = 0;
					cursorRequest = store.openKeyCursor();
					cursorRequest.onsuccess = function() {
						const cursor = this.result;

						if (cursor) {
							if (index.has(cursor.primaryKey)) {
								store.delete(cursor.primaryKey);
								count++;
							}

							cursor.continue();

						} else {
							resolve(count);
						}
					};

				} else {
					cursorRequest = store.openKeyCursor(window.IDBKeyRange.only(index));
					cursorRequest.onsuccess = function() {
						const cursor = this.result;

						if (cursor) {
							store.delete(cursor.primaryKey);
							resolve(1);

						} else {
							resolve(0);
						}
					};
				}

				cursorRequest.onerror = function() {
					const error = this.error;

					consoleMessage(`[${database}::${object}] Delete error [Key: ${index}] [Error: ${error.message}]`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Check if given object exists in database
	 * @param {string} database
	 * @param {string} object
	 * @returns {Promise<boolean>}
	 */
	db.objectStoreExists = function(database, object) {
		return new Promise(function(resolve, reject) {
			openDB(database).then(function(idb) {
				const names = idb.objectStoreNames;
				const keys = Object.keys(idb.objectStoreNames);

				for (let x = 0; x < keys.length; x++) {
					if (names[x] === object) {
						resolve(true);
					}
				}
				resolve(false);

			}).catch(error => {
				openDBThrownError(error);
				reject(error);
			});
		});
	};

	/**
	 * Update key data in database
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|array<string>} key
	 * @param {*} value
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Object>}
	 */
	db.update = function(database, object, key, value, asObject = false) {
		return updateHandler(database, object, key, value, false, asObject);
	};

	/**
	 * Update key data in database or insert if does not exist
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|array<string>} key
	 * @param {*} value
	 * @param {boolean} [asObject=false]
	 * @return {Promise<Object>}
	 */
	db.upsert = function(database, object, key, value, asObject = false) {
		return updateHandler(database, object, key, value, true, asObject);
	};

	/**
	 * Set logging wrappers
	 * @param {function(tag: string, message)} debug
	 * @param {function(tag: string, message)} warn
	 * @param {function(tag: string, message)} error
	 */
	db.setLogging = function(debug, warn, error) {
		log.debug = debug || log.debug;
		log.warn = warn || log.warn;
		log.error = error || log.error;
	};

	/**
	 * Initialize holdDB
	 * This is done through this function so that setLogging could be called before starting of init
	 */
	db.initHoldDB = function() {
		if (initialized) {
			return;
		}

		// Load all created database names to memory to make sure that init has worked correctly when opening
		if (typeof IDBObjectStore === 'function' && typeof window.IDBObjectStore.prototype.getAll !== 'undefined') {
			consoleMessage(`holdDB start`, LOG_DEBUG);

			db.getAll(DB_HOLD, OBJECT_HOLD_DATABASES).then(function(result) {
				result.forEach(function(data) {
					initializedDatabases.set(data.key, data.created);
				});

				initPromises.forEach(function(resolve) {
					resolve();
				});

				initialized = true;
				initPromises.length = 0;

				consoleMessage(`holdDB initialized`, LOG_DEBUG);

			}).catch(function(error) {
				consoleMessage(`[${error.name}:${error.message}] Error initializing database`, LOG_ERROR);
			});

		} else {
			consoleMessage(`This browser is not supported`, LOG_ERROR);
			supported = false;
		}
	};

	// Is indexedDB not supported
	db.isSupported = function() {
		return supported;
	};

	db.IDBCursorDirection = IDBCursorDirection;

	// Add holdDB to window object
	window.holdDB = db;

})(window);

