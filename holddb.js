/**
 * HoldDB.js wrapper to IndexedDB
 *
 * @author Misa Munde
 * @version: 0.1
 *
 * Supported:
 * 	Chrome 48+
 * 	Firefox 45+
 */

/* global IDBKeyRange, IDBObjectStore */

/**
 * IDBFactory is the real type of this data
 * @typedef {{
 *		cmp: Function(string|number, string|number):number,
 *		deleteDatabase: Function(string),
 *		deleteDatabase: Function(string),
 *		open: Function(string, number):Promise,
 * }} indexedDB
 */

/**
 * IDBFactory.open Promise then returns this object
 * @typedef {{
 *		close: Function,
 *		createIndex: Function,
 *		createObjectStore: Function,
 *		deleteObjectStore: Function,
 *		name: string,
 *		objectStoreNames: Array.<string>,
 *		onabort: null,
 *		onclose: null,
 *		onerror: null,
 *		onversionchange: null,
 *		transaction: Function():IDBTransaction,
 *		version: number
 * }} IDBDatabase
 */

/**
 * IDBFactory.delete Promise then returns this object
 * @typedef {{
 *		timeStamp: number,
 *		type: string
 * }} IDBVersionChangeEvent
 */

/**
 * IDBDatabase.transaction returns this object
 * @typedef {{
 *		abort: Function
 *		db: IDBDatabase,
 *		objectStore: Function():IDBObjectStore,
 *		openCursor: Function():IDBRequest
 * }} IDBTransaction
 */

/**
 * IDBTransaction.objectStore function returns this object
 * @typedef {{
 *		count: Function,
 *		delete: Function():IDBRequest,
 *		get: Function,
 *		getAll: Function,
 *		getAllKeys: Function,
 *		open: Function,
 *		openCursor: Function():IDBRequest,
 *		openKeyCursor: Function():IDBRequest,
 *		put: Function,
 *		index: Function():IDBIndex
 * }} IDBObjectStore
 */

/**
 * @typedef {{
 *		error: DOMException,
 *		holdDB: {
 *			database: string,
 *			object: string,
 *			resolve: Function,
 *			reject: Function,
 *			upgraded: boolean|undefined
 *		},
 *		onabort: Function,
 *		onblocked: Function,
 *		onerror: Function,
 *		onsuccess: Function,
 *		onupgradeneeded: Function,
 *		readyState: string,
 *		result: *,
 *		source: IDBIndex|IDBObjectStore|IDBCursor|null,
 *		transaction: *|null
 * }} IDBOpenDBRequest
 */

/**
 * @typedef {{
 *		count: Function,
 *		get: Function():IDBRequest,
 *		getAll: Function():IDBRequest,
 *		getAllKeys: Function,
 *		getKey: Function,
 *		openCursor: Function,
 *		openKeyCursor: Function,
 * }} IDBIndex
 */

/**
 * @typedef {{
 *		bound: Function():IDBKeyRange,
 *		includes: Function():IDBKeyRange,
 *		only: Function():IDBKeyRange,
 *		lowerBound: Function():IDBKeyRange,
 *		upperBound: Function():IDBKeyRange
 * }} IDBKeyRange
 */

/**
 * @typedef {{
 *		error: DOMException,
 *		onerror: null,
 *		onsuccess: null,
 *		readyState: null,
 *		result: null,
 *		source: null,
 *		transaction: null
 * }} IDBRequest
 */

/**
 * @typedef {{
 *		advance: Function,
 *		continue: Function,
 *		delete: Function,
 *		update: Function,
 *		value: Object|string|null,
 *		direction: string,
 *		key: undefined|string,
 *		primaryKey: undefined|string
 * }} IDBCursorWithValue
 */

/**
 * @typedef {{
 *		advance: Function,
 *		continue: Function,
 *		delete: Function,
 *		update: Function,
 *		value: Object|string|null,
 *		direction: string,
 *		key: undefined|string,
 *		primaryKey: undefined|string
 * }} IDBCursor
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
	var LOG_DEBUG = 0;
	var LOG_INFO = 0;
	var LOG_ERROR = 0;

	var DB_HOLD = 'holdDB';
	var OBJECT_HOLD_DATABASES = 'databases';

	/**
	 * Has holdDB been initialized
	 * @type {boolean}
	 */
	var initialized = false;

	/**
	 * Databases initialized
	 * @type {Object.<number|undefined>}
	 */
	var initializedDatabases = {};

	/**
	 * holdDB Initialized promises
	 * @type {Array.<function>}
	 */
	var initPromises = [];

	/**
	 * Opened databases cached
	 * @type {Object.<IDBDatabase>}
	 */
	var databaseCache = {};

	/**
	 * If ObjectStore has unique set as true then setUnique has to be set beforehand to enable postfix ObjectStore name
	 * @see db.setUnique
	 * @type {number|string}
	 */
	var objectStoreUnique;

	/**
	 * Is this browser supported?
	 * @type {boolean}
	 */
	var supported = true;

	/**
	 * Convenience for READ_WRITE
	 * @type {string}
	 */
	var RW = 'readwrite';

	/**
	 * Convenience for READ_ONLY
	 * @type {string}
	 */
	var R = 'readonly';

	/**
	 * Object that will be visible to outside
	 */
	var db = Object.create(null);

	/**
	 * Database schemas and what kind of ObjectStores it can hold
	 * @see holdDBObjectStoreSchema
	 * @type {Object}
	 */
	var schemas = {
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
	 * Write debug
	 * @param {string} message
	 * @param {number} [errorLevel=LOG_DEBUG]
	 */
	function consoleMessage(message, errorLevel) {
		errorLevel = errorLevel || LOG_DEBUG;

		switch (errorLevel) {
			case LOG_DEBUG:
				console.log(`holdDB.js: ${message}`);
				break;

			case LOG_INFO:
				console.info(`holdDB.js: ${message}`);
				break;

			case LOG_ERROR:
				console.error(`holdDB.js: ${message}`);
				break;
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
		var objectData = schemas[database.name];

		/**
		 * @type {holdDBObjectStoreSchema}
		 */
		var storeSchema = objectData.objects[objectName];

		var createOptions = {},
			store;

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
			store = database.createObjectStore(objectName, createOptions);

			// Create indexes
			if (Array.isArray(storeSchema.indexes)) {
				storeSchema.indexes.forEach(function(data) {
					store.createIndex('by_' + data.index, data.index, {
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
		var database = event.target.name;

		consoleMessage(`[${database}] onVersionChange`, LOG_DEBUG);

		if (databaseCache[database] !== undefined && databaseCache[database] !== event.target) {
			databaseCache[database].close();
		}

		event.target.close();

		delete databaseCache[database];
	}

	/**
	 * IDBOpenDBRequest onAbort
	 * @param e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestAbort(e) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var target = e.target;

		var dbName = target.holdDB.database,
			objectName = target.holdDB.object;

		consoleMessage(`[${dbName}::${objectName}] onAbort`, LOG_DEBUG);

		if (databaseCache[dbName]) {
			databaseCache[dbName].close();
			delete databaseCache[dbName];
		}
	}

	/**
	 * IDBOpenDBRequest onBlocked
	 * @param e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestBlocked(e) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var target = e.target;

		consoleMessage(`[${target.holdDB.database}::${target.holdDB.object}] onBlocked`, LOG_DEBUG);
	}

	/**
	 * IDBOpenDBRequest onSuccess
	 * @param e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestSuccess(e) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var target = e.target;

		/**
		 * @type {IDBDatabase}
		 */
		var database = target.result;

		var dbName = target.holdDB.database,
			objectName = target.holdDB.object,
			resolve = target.holdDB.resolve,
			reject = target.holdDB.reject;

		consoleMessage(`[${dbName}] Opened`, LOG_DEBUG);

		// On version change listener to close current cached database because new version is coming
		database.onversionchange = idbOnVersionChange;

		// Make sure that holdDB::databases has this objectStore defined and if not then take required action
		if (dbName !== DB_HOLD && initializedDatabases[dbName] === undefined) {
			// If reset requested and this database has not been just created then do reset
			if (!(target.holdDB.upgraded === true && database.version === 1) && schemas[dbName].reset !== undefined) {
				consoleMessage(`[${dbName}] Database not initialized and reset defined`, LOG_DEBUG);

				db.deleteDB(dbName).then(function() {
					openDBHandle(dbName, objectName, resolve, reject, false);
				});

				return true;
			}

			// If database has been just created so mark it as initialized
			initializeDatabase(dbName);
		}

		// objectStore does not exist so create and that will trigger onUpgradeNeeded that will handle caching etc
		if (objectName !== undefined && database.objectStoreNames.contains(objectName) === false) {
			consoleMessage(`[${dbName}::${objectName}] Create non-existing objectStore`, LOG_DEBUG);
			openDBHandle(dbName, objectName, resolve, reject, false);
			return true;
		}

		// Cache the open connection
		databaseCache[dbName] = database;

		resolve(database);
	}

	/**
	 * IDBOpenDBRequest onUpgradeNeeded
	 * Triggers every time there is need to change database schema including when creating database
	 * @param e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestUpgrade(e) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var target = e.target;

		var database = e.target.result;

		var dbName = target.holdDB.database,
			objectName = target.holdDB.object;

		e.target.transaction.onerror = window.indexedDB.onerror;
		consoleMessage(`[${dbName}] onUpgradeNeeded`, LOG_DEBUG);

		// Mark database as just upgraded
		target.holdDB.upgraded = true;

		if (objectName !== undefined) {
			createObjectStore(database, objectName);
		}
	}

	/**
	 * IDBOpenDBRequest error
	 * @param e
	 * @returns {boolean}
	 */
	function idbOpenDBRequestError(e) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var target = e.target;

		/**
		 * @type {{
		 *		name: string,
		 *		message: string
		 * }|DOMException}
		 */
		var error = target.error;

		var dbName = target.holdDB.database,
			objectName = target.holdDB.object;

		if (error.name === "VersionError") {
			consoleMessage(`[${dbName}] VersionError delete and recreate`, LOG_DEBUG);

			// VersionError for some reason - delete database and trigger again opening of this database
			db.deleteDB(dbName).then(function() {
				openDBHandle(dbName, objectName, target.holdDB.resolve, target.holdDB.reject, false);
			});
			return true;
		}

		if (error.name === "UnknownError") {
			consoleMessage(`[${dbName}] openDB UnknownError`, LOG_DEBUG);

			// UnknownError - at least FF gave this if DB created with newer version and then opened with older
			db.deleteDB(dbName).then(function() {
				consoleMessage(`[${dbName}] UnknownError database has been deleted`, LOG_DEBUG);
				target.holdDB.reject({
					'db': dbName,
					'storage': objectName,
					'name': error.name,
					'message': error.message
				});
			});
			return true;
		}

		if (error.name === "InvalidStateError") {
			if (document.location.pathname.indexOf('469') === -1) {
				consoleMessage(`IndexedDB not supported`, LOG_DEBUG);
				// For now indexedDB is required to run Zyptonite
				document.location = '/469';
			}
			// storage not supported
			supported = false;
		}

		target.holdDB.reject({
			'db': dbName,
			'storage': objectName,
			'name': error.name,
			'message': error.message
		});

		// Suppress error escalating
		return true;
	}

	/**
	 * Set database initialized to holdDB table
	 * @param {string} database
	 */
	function initializeDatabase(database) {
		consoleMessage(`[${database}] Initialize database`, LOG_DEBUG);

		// Set database initialized because it clearly exists
		initializedDatabases[database] = Date.now();

		// Write new object store to general db objectStore
		db.openDB(DB_HOLD, OBJECT_HOLD_DATABASES).then(function(idb) {
			var tx = idb.transaction(OBJECT_HOLD_DATABASES, RW),
				storeList = tx.objectStore(OBJECT_HOLD_DATABASES);

			storeList.put({
				key: database,
				created: Date.now()
			}, database);
		}).catch(openDBThrownError);
	}

	/**
	 * openDB handler
	 * @param {string} dbName
	 * @param {string|null} objectName
	 * @param {Function} resolve
	 * @param {Function} reject
	 * @param {boolean} [validate]
	 */
	function openDBHandle(dbName, objectName, resolve, reject, validate) {
		/**
		 * @type {IDBOpenDBRequest}
		 */
		var request;

		// Validation done only once and if openDBHandle calls it self again then this is not parsed
		if (validate !== false) {
			dbName = openDBHandleValidate(dbName, objectName);
		}

		// Database already open and object storeStore requested
		if (databaseCache[dbName] && objectName !== undefined) {
			// Database has requested ObjectStore already opened so return from cache
			if (databaseCache[dbName].objectStoreNames.contains(objectName) !== false) {
				resolve(databaseCache[dbName]);
				return;
			}

			// Requested ObjectStorage is not open so open new version of database and initialize ObjectStore
			request = window.indexedDB.open(dbName, databaseCache[dbName].version + 1);

		} else {
			// Open the requested database with latest version
			request = window.indexedDB.open(dbName);
		}

		// Bind requested database and objectStore name to IDBOpenDBRequest
		request.holdDB = {
			'database': dbName,
			'object': objectName,
			'resolve': resolve,
			'reject': reject
		};

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
	 * Validate that database and ObjectStore names are good
	 * @param {string} dbName
	 * @param {string} objectName
	 * @returns {string}
	 */
	function openDBHandleValidate(dbName, objectName) {
		var dbData = schemas[dbName];

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
	 * IDBTransaction error
	 * @param {Object} event
	 * @param {Function} reject
	 * @param {string} funcName
	 */
	function transactionError(event, reject, funcName) {
		/**
		 * @type {IDBRequest}
		 */
		var idbRequest = event.target;

		/**
		 * @type {IDBTransaction}
		 */
		var	transaction = event.currentTarget;

		var	error = idbRequest.error;

		// Log these to server so could try to figure out how to fix like multiAdd where constraint error was the reason
		consoleMessage(`[${transaction.db.name}::${idbRequest.source.name}] ${funcName} [Error: ${error.name} :: ${error.message}]`, LOG_DEBUG);

		event.preventDefault();
		reject({
			'db': transaction.db.name,
			'storage': idbRequest.source.name,
			'name': error.name,
			'message': error.message
		});
	}

	/**
	 * openDB thrown error
	 * @param {holdDBException} error
	 */
	function openDBThrownError(error) {
		if (error.db) {
			var target = (error.storage) ? `${error.db}::${error.storage}` : error.db;

			consoleMessage(`[${target}] openDB fatal error [${error.name} / ${error.message}]`, LOG_ERROR);

		} else {
			consoleMessage(`openDB fatal error [${error.name} / ${error.message}]`, LOG_ERROR);
		}
	}

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
		var objectData = schemas[database.split("-")[0]];

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
	 * @returns {Object}
	 */
	db.getDatabases = function() {
		return initializedDatabases;
	};

	/**
	 * Open database
	 * @protected
	 * @param {string} dbName
	 * @param {string} [objectName]
	 * @returns {Promise}
	 */
	db.openDB = function(dbName, objectName) {
		return new Promise(openDBHandle.bind(null, dbName, objectName));
	};

	/**
	 * Initialize new ObjectStore to given database
	 * @param {{
	 *		name: string,
	 *		reset: number|undefined,
	 *		unique: boolean|undefined
	 * }, string} database
	 * @param {Object.<holdDBObjectStoreSchema>|string} [schema]
	 */
	db.initDatabase = function(database, schema) {
		var dbName;

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
		if (schemas[database] !== undefined) {
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
		var objectData = schemas[database];

		// Check that database has been initialized where this new ObjectStore goes to
		if (objectData === undefined) {
			consoleMessage(`[${database}] initObjectStore database does not exist`, LOG_ERROR);
			return false;
		}

		objectData.objects[objectStore] = schema || {};
		return true;
	};

	/**
	 * Count keys in given objectStore
	 * @param {string} database
	 * @param {string} object
	 */
	db.count = function(database, object) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R);

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `has transaction error`);
				};

				/**
				 * @type {IDBObjectStore}
				 */
				var store = tx.objectStore(object);

				var countRequest = store.count();

				countRequest.onsuccess = function(response) {
					resolve(response.target.result);
				};

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Delete all databases
	 * @param {Array} databases
	 */
	db.deleteDatabases = function(databases) {
		return new Promise(function(resolve) {
			var counter = 0,
				databaseCount = databases.length,
				deleted = [],
				x;

			// Log that deleteAllDatabases has been called
			consoleMessage(`DeleteDatabases`, LOG_DEBUG);

			var deleteCallback = function() {
				counter++;

				if (databaseCount === counter) {
					resolve(deleted);
				}
			};

			for (x = 0; x < databaseCount; x++) {
				deleted.push(databases[x]);
				// Delete the database
				db.deleteDB(databases[x]).then(deleteCallback);
			}
		});
	};

	/**
	 * Delete database
	 * @param {string} dbName
	 */
	db.deleteDB = function(dbName) {
		return new Promise(function(resolve, reject) {
			var request;

			consoleMessage(`[${dbName}] Request delete`, LOG_DEBUG);

			if (databaseCache[dbName] !== undefined) {
				databaseCache[dbName].close();
				delete databaseCache[dbName];
			}

			//Opening the DB
			request = window.indexedDB.deleteDatabase(dbName);

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
			request.onerror = function(e) {
				consoleMessage(`[${dbName}] deleteDB error [Error: ${e.target.error.name}]`, LOG_ERROR);
				reject({
					'db': dbName,
					'name': e.target.error.name,
					'message': e.target.error.message
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
					db.openDB(database, storeName).then(function(/*IDBDatabase*/database) {
						var request = window.indexedDB.open(database.name, databaseCache[database.name].version + 1);

						// Handle onUpgradeNeeded
						request.onupgradeneeded = function(e) {
							// Delete requested Object
							e.target.result.deleteObjectStore(storeName);
						};

						// IDB open success
						request.onsuccess = function(e) {
							consoleMessage(`[${storeName}] [${e.target.result.name}] removed object`, LOG_DEBUG);
							resolve();
						};

						// IDB failure
						request.onerror = function(event) {
							// Log error
							consoleMessage(`[${storeName}] [${event.target.error.name}] deleteObject error`, LOG_ERROR);

							event.preventDefault();
							reject();
						};
					}).catch(openDBThrownError);
				} else {
					consoleMessage(`[${database}]::${storeName}] delete ObjectStore does not exist`, LOG_DEBUG);
					resolve();
				}
			}).catch(function(error) {
				// Log these to server so could try to figure out how to fix like multiAdd where constraint error was the reason
				consoleMessage(`[${database}::${storeName}] [Error: ${error.name}] ${error.message}`, LOG_ERROR);
				reject();
			});
		});
	};

	/**
	 * Has key in database
	 * @param {string} database
	 * @param {string} object
	 * @param {string|Array} key
	 */
	db.has = function(database, object, key) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					req;

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `has transaction error`);
				};

				/**
				 * @type {IDBObjectStore}
				 */
				var store = tx.objectStore(object);

				req = store.openKeyCursor(IDBKeyRange.only(key));
				req.onsuccess = function(e) {
					// key already exist
					if (e.target.result !== null) {
						resolve(true);
					} else {
						resolve(false);
					}
				};
			}).catch(openDBThrownError);
		});
	};

	/**
	 * Does given objectStorage exist in given database?
	 * @param {string} database
	 * @param {string} objectName
	 * @return {Promise}
	 */
	db.hasObjectStore = function(database, objectName) {
		return new Promise(function(resolve) {
			db.openDB(database).then(function(/*IDBDatabase*/idb) {
				resolve(idb.objectStoreNames.contains(objectName));
			}).catch(openDBThrownError);
		});
	};

	/**
	 * Add data to database
	 * This is a insert only function. For insert or update see put function
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|Object} key
	 * @param {string|Object} [value]
	 */
	db.add = function(database, object, key, value) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, RW),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					store;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(true);
				};

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `add transaction error`);
				};

				// Get the object store
				store = tx.objectStore(object);

				if (objectData.autoIncrement || objectData.keyPath) {
					store.add(key);

				} else {
					store.add(value, key);
				}
			}).catch(openDBThrownError);
		});
	};

	/**
	 * Add multiple items of data to database
	 * This is a insert only function. For insert or update see put function
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<{key:string, value:*}>|Object} items
	 */
	db.addMulti = function(database, object, items) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, RW),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					error = 0,
					x, store;

				// Transaction completed
				tx.oncomplete = function() {
					resolve({
						items: items.length,
						error: error
					});
				};

				// Transaction error
				tx.onerror = function(event) {
					error++;

					// add throws ConstraintError if mutation does not work for example because of index
					if (event.target.error.name === 'ConstraintError') {
						event.preventDefault();

					} else {
						transactionError(event, reject, `addMulti transaction error`);
					}
				};

				// Get the object store
				store = tx.objectStore(object);

				for (x = 0; x < items.length; x++) {
					if (objectData.autoIncrement || objectData.keyPath) {
						store.add(items[x]);

					} else {
						store.add(items[x].value, items[x].key);
					}
				}
			}).catch(openDBThrownError);
		});
	};

	/**
	 * Put data to database
	 * This is insert or update function. See add for insert only function
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number|Object} key
	 * @param {string|Object} [value]
	 */
	db.put = function(database, object, key, value) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, RW),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					store;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(true);
				};

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `put transaction error`);
				};

				// Get the object store
				store = tx.objectStore(object);

				if (objectData.autoIncrement || objectData.keyPath) {
					store.put(key);

				} else {
					store.put(value, key);
				}

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get data by index from database
	 * @param {string} database
	 * @param {string} object
	 * @param {string} key
	 */
	db.getByIndex = function(database, object, key) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					request;

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `getByIndex transaction error`);
				};

				if (objectData.keyPath !== undefined) {
					request = tx.objectStore(object).index("by_" + objectData.keyPath).get(key);

					request.onsuccess = function() {
						resolve(this.result, key);
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
				} else {
					consoleMessage(`[${database}::${object}] getByIndex usage without defined index`, LOG_ERROR);
					reject({
						db: database,
						storage: object,
						name: 'getByIndex',
						message: 'Usage without defined index'
					});
				}

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get requested items from database
	 * @param {string} database
	 * @param {string} object
	 * @param {string|number} key
	 */
	db.get = function(database, object, key) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					request;

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `get transaction error`);
				};

				request = tx.objectStore(object).get(key);

				request.onsuccess = function(evt) {
					resolve(evt.target.result);
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

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get all the data from database
	 * @param {string} database
	 * @param {string} object
	 * @param {IDBKeyRange} [keyRange]
	 * @param {number} [limit]
	 */
	db.getAll = function(database, object, keyRange, limit) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					request;

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `getAll transaction error`);
				};

				// Default values for range and limit
				keyRange = keyRange || null;
				limit = limit || null;

				request = tx.objectStore(object).getAll(keyRange, limit);

				request.onsuccess = function(evt) {
					resolve(evt.target.result);
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

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get all objectStore of given database
	 * @param {string} database
	 * @return {Promise}
	 */
	db.getDatabaseObjectStores = function(database) {
		return new Promise(function(resolve) {
			db.openDB(database).then(function(/*IDBDatabase*/database) {
				var names = database.objectStoreNames,
					keys = Object.keys(names),
					objects = [],
					x;

				for (x = 0; x < keys.length; x++) {
					objects.push(names[x]);
				}

				resolve(objects);

			}).catch(openDBThrownError);
		});
	};


	/**
	 * Get all database names in the system
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
	 */
	db.getAllKeys = function(database, object) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					request;

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `getAllKeys transaction error`);
				};

				request = tx.objectStore(object).getAllKeys();
				request.onsuccess = function(e) {
					// key already exist
					if (e.target.result !== null) {
						resolve(e.target.result);
					} else {
						resolve(false);
					}
				};

				request.onerror = function() {
					consoleMessage(`[${database}::${object}] getAllKeys error`, LOG_ERROR);
				};
			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get data by cursor
	 * @param {string} database
	 * @param {string} object
	 * @param {IDBKeyRange|null} [range]
	 * @param {string|null} [direction]
	 * @param {number} [limit]
	 */
	db.getCursor = function(database, object, range, direction, limit) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					result = [],
					x = 0,
					reverse, cursorRequest;

				if (direction === 'nextReverse') {
					direction = 'next';
					reverse = true;
				} else if (direction === 'prevReverse') {
					direction = 'prev';
					reverse = true;
				}

				range = range || null;
				direction = direction || "next";
				limit =  limit || null;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(result);
				};

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `getCursor transaction error`);
				};

				cursorRequest = tx.objectStore(object).openCursor(range, direction);

				cursorRequest.onsuccess = function(evt) {
					/**
					 * @type {IDBCursorWithValue|null}
					 */
					var cursor = evt.target.result;

					if (cursor && (limit === null || limit !== null && x < limit)) {
						if (reverse) {
							result.unshift(cursor.value);
						} else {
							result.push(cursor.value);
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

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Get requested keys from the objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {Array.<number|string>} keys
	 * @param {boolean} [asObject=false]
	 */
	db.getKeys = function(database, object, keys, asObject) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					items = (asObject) ? {} : [],
					cursorRequest;

				// Transaction completed
				tx.oncomplete = function() {
					resolve(items);
				};

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `getKeys transaction error`);
				};

				cursorRequest = tx.objectStore(object).openCursor();

				cursorRequest.onsuccess = function(evt) {
					/**
					 * @type IDBCursorWithValue|null
					 */
					var cursor = evt.target.result;

					if (cursor) {
						if (keys.indexOf(cursor.primaryKey) !== -1) {
							if (asObject) {
								items[cursor.primaryKey] = cursor.value;
							} else {
								items.push(cursor.value);
							}
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

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Cursor iterating through elements
	 * @param {string} database
	 * @param {string} object
	 * @param {Function} handler
	 * @param {IDBKeyRange} [range]
	 * @param {string} [direction]
	 */
	db.cursorWalk = function(database, object, handler, range, direction) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, R),
					cursorRequest;

				range = range || null;
				direction = direction || "next";

				// Transaction completed
				tx.oncomplete = function() {
					resolve();
				};

				// Transaction error
				tx.onerror = function(event) {
					transactionError(event, reject, `cursorWalk transaction error`);
				};

				cursorRequest = tx.objectStore(object).openCursor(range, direction);

				cursorRequest.onsuccess = function(evt) {
					/**
					 * @type IDBCursorWithValue|null
					 */
					var cursor = evt.target.result;

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

			}).catch(openDBThrownError);
		});
	};

	//noinspection ReservedWordAsName
	/**
	 * Delete key from objectStore
	 * @param {string} database
	 * @param {string} object
	 * @param {string|Set} index
	 */
	db.delete = function(database, object, index) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, RW),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					cursorRequest;

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
				tx.onerror = function(event) {
					transactionError(event, reject, `delete transaction error`);
				};

				/**
				 * @type {IDBObjectStore}
				 */
				var store = tx.objectStore(object);

				if (index instanceof Set) {
					cursorRequest = store.openKeyCursor();
					cursorRequest.onsuccess = function(evt) {
						/**
						 * @type IDBCursor|null
						 */
						var cursor = evt.target.result;

						if (cursor !== null) {
							if (index.has(cursor.primaryKey)) {
								store.delete(cursor.primaryKey);
							}

							cursor.continue();

						} else {
							resolve();
						}
					};

				} else {
					cursorRequest = store.openKeyCursor(IDBKeyRange.only(index));
					cursorRequest.onsuccess = function(evt) {
						/**
						 * @type IDBCursor|null
						 */
						var cursor = evt.target.result;

						if (cursor !== null) {
							store.delete(cursor.primaryKey);
						}

						resolve(false);
					};
				}

				cursorRequest.onerror = function(event) {
					var	error = event.target.error;

					consoleMessage(`[${database}::${object}] Delete error [Key: ${index}] [Error: ${error.message}]`, LOG_ERROR);
					reject({
						'db': database,
						'storage': object,
						'name': error.name,
						'message': error.message
					});
				};

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Check if given object exists in database
	 * @param {string} database
	 * @param {string} object
	 * @returns {Promise}
	 */
	db.objectStoreExists = function(database, object) {
		return new Promise(function(resolve) {
			db.openDB(database).then(function(/*IDBDatabase*/idb) {
				var names = idb.objectStoreNames,
					keys = Object.keys(idb.objectStoreNames),
					x;

				for (x = 0; x < keys.length; x++) {
					if (names[x] === object) {
						resolve(true);
					}
				}
				resolve(false);

			}).catch(openDBThrownError);
		});
	};

	/**
	 * Update key database or insert if not existing and put was requested
	 * @notice this function takes key value pair to update object or just key to be inserted or function to callback changes
	 * @param {string} database
	 * @param {string} object
	 * @param {string} key
	 * @param {*} [value]
	 * @param {boolean} [insert]
	 */
	db.update = function(database, object, key, value, insert) {
		return new Promise(function(resolve, reject) {
			db.openDB(database, object).then(function(/*IDBDatabase*/idb) {
				var tx = idb.transaction(object, RW),
					db = schemas[idb.name] || {},
					objectData = db.objects[object] || false,
					cursorRequest;

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
				tx.onerror = function(event) {
					transactionError(event, reject, `update transaction error`);
				};

				/**
				 * @type {IDBObjectStore}
				 */
				var store = tx.objectStore(object);

				cursorRequest = store.openCursor(IDBKeyRange.only(key));

				cursorRequest.onsuccess = function(evt) {
					/**
					 * @type IDBCursorWithValue|null
					 */
					var cursor = evt.target.result;

					var	storeData;

					if (cursor !== null) {
						storeData = (typeof value === 'function') ? value(cursor.value) : value;

						if (objectData.keyPath) {
							storeData[objectData.keyPath] = key;
							cursor.update(storeData);

						} else {
							cursor.update(storeData, key);
						}

					} else if (insert === true) {
						storeData = (typeof value === 'function') ? value(null) : value;
						store.put(storeData, key);

					} else {
						reject({
							'db': database,
							'storage': object,
							'name': `IDBUpdate`,
							'message': `Requested key does not exist or insert not used`
						});
						return;
					}

					resolve(storeData);
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

			}).catch(openDBThrownError);
		});
	};

	// Is indexedDB not supported
	db.isSupported = function() {
		return supported;
	};

	// Load all created database names to memory to make sure that init has worked correctly when opening
	if (typeof IDBObjectStore.prototype.getAll !== "undefined") {
		db.getAll(DB_HOLD, OBJECT_HOLD_DATABASES).then(function(result) {
			result.forEach(function(data) {
				initializedDatabases[data.key] = data.created;
			});

			initPromises.forEach(function(resolve) {
				resolve();
			});

			initialized = true;
			initPromises.length = 0;

		}).catch(function(error) {
			consoleMessage(`[${error.name}:${error.message}] Error initializing database`, LOG_ERROR);
		});

	} else {
		consoleMessage(`This browser is not supported`, LOG_ERROR);
		supported = false;
	}

	// Add holdDB to window object
	window.holdDB = db;

})(window);

