// Detail tiles never gate entry. A slow forecast must not hide usable relief.
export const localPreviewReady=(relief,weather,elapsed)=>Boolean(relief&&(weather||elapsed>=5000));
