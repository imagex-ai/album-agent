// Builds from older installations can lack the optional SDK until dependencies
// are installed. Never report success when the SDK is unavailable.
function unavailable(): never { throw new Error('feedback_unavailable'); }
export { unavailable as init, unavailable as addEventProcessor,
  unavailable as feedbackIntegration, unavailable as globalHandlersIntegration,
  unavailable as getFeedback };
