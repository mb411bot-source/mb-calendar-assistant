function formatAlexaSpeech(speechText, shouldEndSession = true, repromptText = null) {
  let cleanSpeech = (speechText || '')
    .replace(/[*_#`\n]/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[<>'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  cleanSpeech = cleanSpeech
    .replace(/\bELA\b/gi, 'English Language Arts')
    .replace(/\bPE\b/gi, 'fizz ed')
    .replace(/\bSS\b/gi, 'social studies')
    .replace(/\bPhysical Education\b/gi, 'fizz ed');

  const ssml = `<speak>${cleanSpeech || "I didn't receive a response."}</speak>`;

  const responseBody = {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'SSML',
        ssml: ssml
      },
      shouldEndSession: shouldEndSession
    }
  };

  // If keeping the session open, Alexa requires a reprompt
  if (!shouldEndSession) {
    const cleanReprompt = (repromptText || "What would you like to know?")
      .replace(/[*_#`\n]/g, ' ')
      .replace(/&/g, 'and')
      .replace(/[<>'"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    responseBody.response.reprompt = {
      outputSpeech: {
        type: 'SSML',
        ssml: `<speak>${cleanReprompt}</speak>`
      }
    };
  }

  return Response.json(responseBody, { status: 200 });
}
