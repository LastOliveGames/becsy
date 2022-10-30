import {promises as fs} from 'fs';
import {Session} from 'inspector';
import {promisify} from 'util';

export async function profile(fn: () => Promise<any>): Promise<any> {
  const session = new Session();
  session.connect();
  const post = promisify(session.post.bind(session)) as (cmd: string) => Promise<any>;
  await post('Profiler.enable');
  await post('Profiler.start');

  const result = await fn();

  const prof = (await post('Profiler.stop')).profile;
  await post('Profiler.disable');

  await fs.writeFile(`./profile_${Date.now()}.cpuprofile`, JSON.stringify(prof));
  return result;
}
