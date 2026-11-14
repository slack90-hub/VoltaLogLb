import { EmailMessage } from 'cloudflare:email';
import { handleRequest } from './handler.mjs';

export default {
  fetch(request, env) {
    return handleRequest(request, env, raw => env.EMAIL.send(
      new EmailMessage('mic@mdslb.com', env.DELIVERY_ADDRESS, raw)
    ));
  }
};
