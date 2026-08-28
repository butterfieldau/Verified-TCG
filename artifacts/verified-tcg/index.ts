import {
  installStartupDiagnostics,
  recordStartupPhase,
} from './services/startupDiagnostics';

declare const require: (moduleName: string) => unknown;

installStartupDiagnostics();
recordStartupPhase('js-entry', 'success');

require('expo-router/entry');