import { api, db, fetch, FormData, InputFile } from 'sdk';
import { createRuntime } from './composition/runtime.js';

const runtime = createRuntime({
  db,
  api,
  fetcher: fetch,
  makeFormData: () => new FormData(),
  makeFile: (bytes, name) =>
    new InputFile(bytes, name, {
      type: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    }),
  log: (event, fields) => console.info(event, fields),
});
export const onMessage = runtime.onMessage;
export const onCallback = runtime.onCallback;
export const onBusinessConnection = runtime.onBusinessConnection;
export const onPreCheckout = runtime.onPreCheckout;

// Management-only entrypoints. Public Telegram handlers never dispatch these.
export const configure = runtime.configure;
export const status = runtime.status;
export const probe = runtime.probe;
export const walletStatus = runtime.walletStatus;

export const getAgentSettings = runtime.getAgentSettings;
export const updateAgentSettings = runtime.updateAgentSettings;
export const refreshAgentModelProfile = runtime.refreshAgentModelProfile;

export const onGuestMessage = runtime.onGuestMessage;

export const onBusinessMessage = runtime.onBusinessMessage;

export const initializeFeatures = runtime.initializeFeatures;

export const getAccessPolicy = runtime.getAccessPolicy;

export const updateAccessPolicy = runtime.updateAccessPolicy;

export const getSecretarySettings = runtime.getSecretarySettings;

export const updateSecretarySettings = runtime.updateSecretarySettings;

export const listWorkspace = runtime.listWorkspace;

export const readWorkspace = runtime.readWorkspace;

export const writeWorkspace = runtime.writeWorkspace;

export const listTasks = runtime.listTasks;

export const getTask = runtime.getTask;

export const taskHistory = runtime.taskHistory;

export const saveTask = runtime.saveTask;

export const setTaskEnabled = runtime.setTaskEnabled;

export const runTaskNow = runtime.runTaskNow;

export const stopTask = runtime.stopTask;

export const getHeartbeat = runtime.getHeartbeat;

export const updateHeartbeat = runtime.updateHeartbeat;

export const schedulerTick = runtime.schedulerTick;

export const decideTaskDraft = runtime.decideTaskDraft;

export const listTaskDrafts = runtime.listTaskDrafts;

export const listDueTasks = runtime.listDueTasks;

export const runScheduledTask = runtime.runScheduledTask;

export const getWebSettings = runtime.getWebSettings;
export const configureWeb = runtime.configureWeb;

export const getTonServices = runtime.getTonServices;
export const configureTonServices = runtime.configureTonServices;
