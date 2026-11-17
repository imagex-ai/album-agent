import { version as appVersion } from '../../package.json';
import { sanitizeSentryEvent, type SentryPrivacyEvent } from './sentryPrivacy';

type FeedbackForm = { appendToDom(): void; removeFromDom(): void; open(): void };
type SentrySdk = {
  addEventProcessor(processor: (event: SentryPrivacyEvent) => SentryPrivacyEvent | null): void;
  init(options: Record<string, unknown>): void;
  globalHandlersIntegration(): unknown;
  feedbackIntegration(options: Record<string, unknown>): unknown;
  getFeedback(): { createForm(options: Record<string, unknown>): Promise<FeedbackForm> } | undefined;
};

const configuredDsn = __IMAGEX_SENTRY_SDK_AVAILABLE__ ? (import.meta.env.VITE_SENTRY_DSN?.trim() || '') : '';
let monitoringEnabled = () => false;
let sdkPromise: Promise<SentrySdk> | undefined;
let noticeShownThisSession = false;
const DIAGNOSTICS_NOTICE_KEY = 'imagex_error_reporting_notice_shown';

export function feedbackConfigured(): boolean {
  return Boolean(configuredDsn);
}

export function claimDiagnosticsNotice(): boolean {
  if (noticeShownThisSession) return false;
  noticeShownThisSession = true;
  try {
    if (localStorage.getItem(DIAGNOSTICS_NOTICE_KEY) === '1') return false;
    localStorage.setItem(DIAGNOSTICS_NOTICE_KEY, '1');
  } catch (_) {
    // If storage is unavailable, show the disclosure again on the next launch.
  }
  return true;
}

export async function initializeFeedback(getMonitoringEnabled: () => boolean): Promise<boolean> {
  monitoringEnabled = getMonitoringEnabled;
  if (!configuredDsn) return false;
  if (!sdkPromise) {
    // The older updater may build before installing the optional SDK. Vite
    // substitutes a failure-only module in that situation.
    // @ts-ignore Optional at build time for legacy source installations.
    sdkPromise = (import('@sentry/browser') as Promise<SentrySdk>).then(sentry => {
      sentry.addEventProcessor(event => sanitizeSentryEvent(event, monitoringEnabled()));
      sentry.init({
        dsn: configuredDsn,
        release: appVersion,
        defaultIntegrations: false,
        integrations: [
          sentry.globalHandlersIntegration(),
          sentry.feedbackIntegration({ autoInject: false, showName: false, isEmailRequired: false }),
        ],
        sendClientReports: false,
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        beforeSend: (event: SentryPrivacyEvent) => sanitizeSentryEvent(event, monitoringEnabled()),
      });
      return sentry;
    }).catch(error => {
      sdkPromise = undefined;
      throw error;
    });
  }
  await sdkPromise;
  return true;
}

export async function openFeedback(isEn: boolean, isLight: boolean): Promise<boolean> {
  if (!configuredDsn || !sdkPromise) return false;
  const sentry = await sdkPromise;
  const feedback = sentry.getFeedback();
  if (!feedback) return false;
  let form: FeedbackForm;
  form = await feedback.createForm({
    colorScheme: isLight ? 'light' : 'dark',
    showName: false,
    showEmail: true,
    isEmailRequired: false,
    enableScreenshot: true,
    formTitle: isEn ? 'Send feedback' : 'Enviar feedback',
    messageLabel: isEn ? 'What would you like to share?' : 'O que você gostaria de contar?',
    messagePlaceholder: isEn ? 'Describe a problem, suggestion or other feedback.' : 'Descreva um problema, sugestão ou outro comentário.',
    emailLabel: isEn ? 'Email (optional)' : 'E-mail (opcional)',
    emailPlaceholder: isEn ? 'For a reply, if you wish' : 'Para receber uma resposta, se quiser',
    submitButtonLabel: isEn ? 'Send feedback' : 'Enviar feedback',
    cancelButtonLabel: isEn ? 'Cancel' : 'Cancelar',
    confirmButtonLabel: isEn ? 'Confirm' : 'Confirmar',
    addScreenshotButtonLabel: isEn ? 'Add screenshot' : 'Adicionar captura de tela',
    removeScreenshotButtonLabel: isEn ? 'Remove screenshot' : 'Remover captura de tela',
    highlightToolText: isEn ? 'Highlight' : 'Destacar',
    hideToolText: isEn ? 'Hide' : 'Ocultar',
    removeHighlightText: isEn ? 'Remove' : 'Remover',
    isRequiredLabel: isEn ? 'Required' : 'Obrigatório',
    successMessageText: isEn ? 'Thank you for your feedback!' : 'Obrigado pelo seu feedback!',
    errorEmptyMessageText: isEn ? 'Please enter a message.' : 'Escreva uma mensagem.',
    errorNoClientText: isEn ? 'Feedback is not available right now.' : 'O feedback não está disponível agora.',
    errorTimeoutText: isEn ? 'Sending timed out. Please try again.' : 'O envio demorou demais. Tente novamente.',
    errorForbiddenText: isEn ? 'Sending is unavailable from this address.' : 'O envio não está disponível neste endereço.',
    errorGenericText: isEn ? 'Could not send feedback. Please try again.' : 'Não foi possível enviar. Tente novamente.',
    onFormClose: () => form?.removeFromDom(),
  });
  form.appendToDom();
  form.open();
  return true;
}
