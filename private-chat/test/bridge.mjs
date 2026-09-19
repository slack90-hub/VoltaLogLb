// This test-only RPC bridge is never included in the deployment entry point.
import worker, {PrivateRoom} from '../src/worker.mjs';
export class TestRoom extends PrivateRoom {
  async inspect(query,args=[]) { return this.rows(query,...args); }
}
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname==='/__test') {
      const data=await request.json(); const room=env.ROOM.getByName('nad-maria-v1');
      if(data.wake) {await room.wake();return Response.json({ok:true});}
      return Response.json(await room.inspect(data.query,data.args));
    }
    return worker.fetch(request,env);
  }
};
