import fs from 'fs';
import inspector from 'inspector';
import util from 'util';

const writeFile = util.promisify(fs.writeFile);

export async function profile(fn: () => Promise<void>): Promise<void> {
  const session = new inspector.Session();
  session.connect();
  const post = util.promisify(session.post.bind(session)) as (cmd: string) => Promise<any>;
  await post('Profiler.enable');
  await post('Profiler.start');

  await fn();

  const prof = (await post('Profiler.stop')).profile;
  await post('Profiler.disable');

  await writeFile(`./profile_${Date.now()}.cpuprofile`, JSON.stringify(prof));
}
