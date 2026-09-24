// tsx calls os.userInfo() on Windows to name its temporary directory. Some
// locked-down Windows runners return ENOMEM for that native call. Supplying a
// stable uid avoids the platform lookup without changing application code.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  process.geteuid = () => 0;
}
