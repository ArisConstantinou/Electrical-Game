import { buildMeshJob, type MasonryMeshJob } from './masonryMesher';
// Each snapshot is immutable and local to a dirty patch. Typed arrays transfer
// ownership both ways; no scene objects, DOM or WebGL are touched in the worker.
self.onmessage = (event: MessageEvent<{key:string;revision:number;job:MasonryMeshJob}>) => {
  const start=performance.now();
  const {key,revision,job}=event.data;
  const data=buildMeshJob(job);
  self.postMessage({key,revision,data,milliseconds:performance.now()-start}, {transfer:[data.positions.buffer,data.normals.buffer,data.colors.buffer]});
};
