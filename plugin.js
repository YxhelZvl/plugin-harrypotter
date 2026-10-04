const URL_DATOS = 'https://raw.githubusercontent.com/YxhelZvl/kino-datasource/refs/heads/main/harry_potter.json';

// 🪄 1. Desencriptar la URL ofuscada
async function desencriptarUrl(urlOfuscada) {
  if (!urlOfuscada.startsWith('YxhelZvl::')) {
    return urlOfuscada;
  }

  const payload = urlOfuscada.substring(10);
  const ivBase64 = payload.substring(0, 16);
  const datosConTag = payload.substring(16);
  
  const clave = await kino.secret('hpKey');
  const ivHex = Buffer.from(ivBase64, 'base64').toString('hex');

  try {
    return await kino.crypto.decrypt('aes-256-gcm', {
      key: clave,
      keyEncoding: 'hex',
      iv: ivHex,
      ivEncoding: 'hex',
      data: datosConTag
    });
  } catch (e) {
    console.error("Fallo al desencriptar:", e.message);
    return urlOfuscada; 
  }
}

// 🌐 Resolvedor de Yandex Disk (Versión Final Optimizada)
async function resolverYandex(url) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  // Paso 1: Obtener el HTML de la página pública
  const r = await kino.fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"
    },
    timeoutMs: 30000
  });
  if (!r.ok) throw new Error("No se pudo acceder a la página de Yandex");
  
  const html = await r.text();

  // Paso 2: Extraer el bloque store-prefetch
  const match = html.match(/<script[^>]*id=["']store-prefetch["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("No se encontró store-prefetch en la página de Yandex");
  
  const store = JSON.parse(match[1]);

  // Paso 3: Localizar el recurso principal
  const rootId = store.rootResourceId;
  const resources = store.resources || {};
  let resource = resources[rootId];
  
  if (!resource) {
    for (const key in resources) {
      if (resources[key] && resources[key].type === "file") {
        resource = resources[key];
        break;
      }
    }
  }
  if (!resource) throw new Error("No se encontró ningún recurso de tipo file");

  // Paso 4: Extraer datos necesarios (hash, sk, uid)
  const fileHash = resource.hash || resource.path;
  if (!fileHash) throw new Error("El recurso no contiene hash/path");

  const environment = store.environment || {};
  const sk = environment.externalSk || environment.sk || environment.authSk;
  if (!sk) throw new Error("No se encontró el parámetro sk");

  // Paso 5: Solicitar URL de descarga a la API de Yandex
  const payload = { hash: fileHash, sk: sk };
  const postRes = await kino.fetch("https://disk.yandex.ru/public/api/download-url", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
    timeoutMs: 30000
  });
  
  if (!postRes.ok) throw new Error("Error en la petición a la API de Yandex");
  const postData = await postRes.json();
  
  if (postData.error) throw new Error(`Yandex devolvió un error: ${JSON.stringify(postData)}`);
  
  const downloadUrl = postData.data?.url;
  if (!downloadUrl) throw new Error("No se encontró data.url en la respuesta de Yandex");

  // Paso 6: ¡EL TRUCO! Usar HEAD para seguir redirecciones SIN descargar el video (evita límite de 5MB)
  const redirectRes = await kino.fetch(downloadUrl, {
    method: "HEAD",
    timeoutMs: 30000
  });
  
  if (!redirectRes.ok) {
    throw new Error(`Error al seguir la redirección: ${redirectRes.status}`);
  }

  // redirectRes.url contiene la URL final limpia después de todas las redirecciones
  return redirectRes.url.trim();
}

// 🏠 3. Pantalla de Inicio
export async function home() {
  const r = await kino.fetch(URL_DATOS);
  if (!r.ok) throw kino.error('unavailable', 'No se pudo cargar la lista de películas.');
  
  const datos = await r.json();

  return [{
    id: 'hp-saga-completa',
    title: 'Saga Completa de Harry Potter',
    items: datos.peliculas.map(p => ({
      id: p.id,
      title: p.titulo,
      subtitle: `${p.anio} • ${p.calidad} • ${p.tamano}`,
      image: p.imagen,
      ref: p.id,
      kind: 'movie'
    }))
  }];
}

// 🔍 4. Búsqueda
export async function search(query) {
  const r = await kino.fetch(URL_DATOS);
  if (!r.ok) throw kino.error('unavailable', 'No se pudo buscar.');
  
  const datos = await r.json();
  const busqueda = (query.q || "").toLowerCase();

  return { 
    items: datos.peliculas
      .filter(p => 
        p.titulo.toLowerCase().includes(busqueda) || 
        p.alternativoT.toLowerCase().includes(busqueda) ||
        p.anio.toString().includes(busqueda)
      )
      .map(p => ({
        id: p.id,
        title: p.titulo,
        subtitle: `${p.anio} • ${p.calidad} • ${p.tamano}`,
        image: p.imagen,
        ref: p.id,
        kind: 'movie'
      }))
  };
}

// ▶️ 5. Reproducir (¡Aquí ocurre la magia!)
export async function resolve(ref) {
  const r = await kino.fetch(URL_DATOS);
  if (!r.ok) throw kino.error('unavailable', 'No se pudo obtener el video.');
  
  const datos = await r.json();
  const pelicula = datos.peliculas.find(p => p.id === ref);
  if (!pelicula) throw kino.error('not_found', 'Película no encontrada.');

  // 1. Desencriptamos la URL
  let urlReal = await desencriptarUrl(pelicula.url);

  // 2. Si es una URL de Yandex Disk, la resolvemos a su enlace directo
  if (urlReal.includes("yadi.sk") || urlReal.includes("disk.yandex")) {
    console.log("🔄 Resolviendo URL de Yandex Disk a enlace directo...");
    urlReal = await resolverYandex(urlReal);
    console.log("✅ URL directa obtenida:", urlReal);
  }

  // 3. Entregamos la URL directa a Kino
  return {
    title: pelicula.titulo,
    streams: [{
      url: urlReal,
      title: pelicula.calidad
    }]
  };
}