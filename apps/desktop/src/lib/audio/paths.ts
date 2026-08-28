const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /^\\\\/;

export function isUriAssetPath(path: string): boolean {
  const cleaned = path.trim();
  return !WINDOWS_DRIVE_PATTERN.test(cleaned) && URI_SCHEME_PATTERN.test(cleaned);
}

export function isAbsoluteAssetPath(path: string): boolean {
  const cleaned = path.trim();
  return cleaned.startsWith("/") || WINDOWS_DRIVE_PATTERN.test(cleaned) || UNC_PATH_PATTERN.test(cleaned);
}

export function resolveProjectAssetPath(projectPath: string | null | undefined, assetPath: string | null | undefined): string | null {
  if (!assetPath) {
    return null;
  }

  const cleanedAssetPath = assetPath.trim();

  if (!cleanedAssetPath) {
    return null;
  }

  if (isUriAssetPath(cleanedAssetPath) || isAbsoluteAssetPath(cleanedAssetPath)) {
    return cleanedAssetPath;
  }

  if (!projectPath) {
    return null;
  }

  const cleanedProjectPath = projectPath.trim().replace(/[\\/]+$/, "");

  if (!cleanedProjectPath) {
    return null;
  }

  const normalizedRelativePath = cleanedAssetPath.replace(/^\.[\\/]/, "").replace(/^[\\/]+/, "");
  const separator = cleanedProjectPath.includes("\\") && !cleanedProjectPath.includes("/") ? "\\" : "/";

  return `${cleanedProjectPath}${separator}${normalizedRelativePath}`;
}
