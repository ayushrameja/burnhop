import { OutpostArtwork, type ArtworkRequest } from './outpostArtwork';

const artwork = new OutpostArtwork();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ArtworkRequest & { serial: number }>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const surface = new OffscreenCanvas(Math.ceil(data.width * data.resolution), Math.ceil(data.height * data.resolution));
    const ctx = surface.getContext('2d');
    if (!ctx) throw new Error('Worker canvas unavailable');
    ctx.scale(data.resolution, data.resolution); ctx.translate(-data.x, -data.y);
    artwork.paintTerrain(ctx as unknown as CanvasRenderingContext2D, data);
    const bitmap = surface.transferToImageBitmap();
    scope.postMessage({ id: data.id, serial: data.serial, resolution: data.resolution, bitmap }, [bitmap]);
    surface.width = surface.height = 0;
  } catch {
    scope.postMessage({ id: data.id, serial: data.serial, error: true }, []);
  }
};
