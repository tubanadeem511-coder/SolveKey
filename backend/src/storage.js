import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionByMediaType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 1_500_000;

function decodeImage(imageBase64, mediaType) {
  if (typeof imageBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(imageBase64)) {
    throw new Error("Report image is not valid base64");
  }
  const image = Buffer.from(imageBase64, "base64");
  if (!image.length || image.length > MAX_IMAGE_BYTES) {
    throw new Error("Report image must be between 1 byte and 1.5 MB");
  }

  const validSignature = mediaType === "image/jpeg"
    ? image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
    : mediaType === "image/png"
      ? image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mediaType === "image/webp"
        ? image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP"
        : false;
  if (!validSignature) throw new Error("Report image content does not match its media type");
  return image;
}

export function validateReportImage(imageBase64, mediaType) {
  decodeImage(imageBase64, mediaType);
}

export const localUploadsPath = path.resolve(
  process.env.LOCAL_UPLOAD_DIR || fileURLToPath(new URL("../uploads/", import.meta.url)),
);

async function saveLocally(imageBase64, mediaType) {
  const extension = extensionByMediaType[mediaType];
  if (!extension) throw new Error(`Unsupported report image media type: ${mediaType}`);

  const image = decodeImage(imageBase64, mediaType);

  await mkdir(localUploadsPath, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(localUploadsPath, filename), image, { flag: "wx" });
  const publicBaseUrl = (process.env.API_PUBLIC_URL || "http://localhost:4000").replace(/\/$/, "");
  return `${publicBaseUrl}/uploads/${filename}`;
}

export async function uploadReportImage(imageBase64, mediaType) {
  const image = decodeImage(imageBase64, mediaType);
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  const configuredValues = [cloudName, apiKey, apiSecret].filter(Boolean).length;
  if (configuredValues === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Configure Cloudinary image storage for production");
    }
    return saveLocally(imageBase64, mediaType);
  }
  if (configuredValues !== 3) {
    throw new Error("Cloudinary configuration is incomplete");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = process.env.CLOUDINARY_FOLDER || "SolveKey/reports";
  const signatureBase = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash("sha1").update(signatureBase).digest("hex");
  const form = new FormData();
  form.append("file", new Blob([image], { type: mediaType }), "report-image");
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok || typeof result.secure_url !== "string") {
    throw new Error(result.error?.message || `Cloudinary upload failed with status ${response.status}`);
  }
  return result.secure_url;
}

export async function loadImageForVision(imageUrl) {
  const url = new URL(imageUrl);
  const apiUrl = new URL(process.env.API_PUBLIC_URL || "http://localhost:4000");
  if (url.origin === apiUrl.origin && url.pathname.startsWith("/uploads/")) {
    const filename = path.basename(url.pathname);
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) {
      throw new Error("Stored report image path is invalid");
    }
    const image = await readFile(path.join(localUploadsPath, filename));
    if (image.length > MAX_IMAGE_BYTES) throw new Error("Stored report image exceeds the size limit");
    const mediaType = Object.keys(extensionByMediaType).find((type) => extensionByMediaType[type] === path.extname(filename).slice(1));
    if (!mediaType) throw new Error("Stored report image type is unsupported");
    decodeImage(image.toString("base64"), mediaType);
    return { imageBase64: image.toString("base64"), mediaType };
  }

  if (!process.env.CLOUDINARY_CLOUD_NAME || url.hostname !== "res.cloudinary.com" ||
      !url.pathname.startsWith(`/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`)) {
    throw new Error("Stored report image is not hosted by the configured image provider");
  }
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok || !response.body) {
    throw new Error(`Could not load stored report image (HTTP ${response.status})`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (!contentType || !extensionByMediaType[contentType]) {
    throw new Error("Stored report image has an unsupported media type");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Stored report image exceeds the size limit");
    }
    chunks.push(Buffer.from(value));
  }
  const image = Buffer.concat(chunks);
  const imageBase64 = image.toString("base64");
  decodeImage(imageBase64, contentType);
  return { imageBase64, mediaType: contentType };
}
