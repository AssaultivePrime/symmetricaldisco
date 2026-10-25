// Thin fetch wrapper + XHR upload with progress.

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0, null);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

export function uploadFile(file, { folder = '', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    if (folder) fd.append('folder', folder);
    fd.append('files', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.assets?.length) resolve(data.assets[0]);
      else reject(new ApiError(data?.errors?.[0]?.error || data?.error || `Upload failed (${xhr.status})`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed: connection problem.', 0, null));
    xhr.send(fd);
  });
}
