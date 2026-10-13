// Length-prefixed binary protocol; fields are UTF-8 length/value pairs, never parsed JSON.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <vector>
#include <io.h>
#include <fcntl.h>
#include <algorithm>

static bool read32(const std::vector<char>& b, size_t& p, DWORD& v) { if (p + 4 > b.size()) return false; memcpy(&v, b.data() + p, 4); p += 4; return true; }
static bool readString(const std::vector<char>& b, size_t& p, std::string& v) { DWORD n{}; if (!read32(b,p,n) || p+n > b.size()) return false; v.assign(b.data()+p,n); p += n; return true; }
static void put32(std::vector<char>& b, DWORD v) { const auto p = reinterpret_cast<const char*>(&v); b.insert(b.end(), p, p+4); }
static void putString(std::vector<char>& b, const std::string& v) { put32(b, static_cast<DWORD>(v.size())); b.insert(b.end(), v.begin(), v.end()); }
static std::wstring wide(const std::string& value) { const auto n = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0); std::wstring out(n, L'\0'); MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), n); return out; }
static std::wstring quote(const std::wstring& value) { std::wstring out = L"\""; unsigned slashes = 0; for (wchar_t ch : value) { if (ch == L'\\') { ++slashes; continue; } if (ch == L'\"') out.append(slashes * 2 + 1, L'\\'); else out.append(slashes, L'\\'); slashes = 0; out += ch; } out.append(slashes * 2, L'\\'); return out + L"\""; }
static void reply(DWORD code, const std::string& session, DWORD pid, DWORD active) { std::vector<char> body; put32(body, code); putString(body, session); put32(body,pid); put32(body,active); const DWORD n = static_cast<DWORD>(body.size()); std::cout.write(reinterpret_cast<const char*>(&n),4); std::cout.write(body.data(),body.size()); std::cout.flush(); }

static int run_control_bridge();


// Node/libuv supplies the CRT descriptor table in STARTUPINFO.reserved2. Preserve it for
// FD3 bootstrap/fork IPC; FD4 belongs only to this native Job supervisor.
static bool managed_reply(const std::string& event, DWORD code, DWORD pid, DWORD active) {
  std::vector<char> body; put32(body, code); putString(body, event); put32(body, pid); put32(body, active);
  std::vector<char> frame; put32(frame, static_cast<DWORD>(body.size())); frame.insert(frame.end(), body.begin(), body.end());
  size_t written = 0;
  while (written < frame.size()) {
    const int n = _write(4, frame.data() + written, static_cast<unsigned>(frame.size() - written));
    if (n <= 0) return false;
    written += n;
  }
  return true;
}

// Faults are compiled only into the isolated test executable, never the shipped mechanism.
struct ManagedWindowsApi {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
  std::wstring fault;
  unsigned failed_termination = 0;
  unsigned failed_query = 0;
  bool first_stop = true;
  ManagedWindowsApi() { wchar_t value[80]{}; if (GetEnvironmentVariableW(L"GLIMMER_TEST_PROCESS_TREE_FAULT", value, 80) < 80) fault = value; }
#endif
  bool assign(HANDLE job, HANDLE process) {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
    if (fault == L"assign") { SetLastError(ERROR_ACCESS_DENIED); return false; }
#endif
    return AssignProcessToJobObject(job, process) != FALSE;
  }
  DWORD resume(HANDLE thread) {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
    if (fault == L"resume") { SetLastError(ERROR_ACCESS_DENIED); return static_cast<DWORD>(-1); }
#endif
    return ResumeThread(thread);
  }
  bool terminate_job(HANDLE job) {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
    if (fault == L"resume" && failed_termination++ < 10) { SetLastError(ERROR_ACCESS_DENIED); return false; }
    if (fault == L"stop-timeout" && first_stop) { first_stop = false; return true; }
#endif
    return TerminateJobObject(job, 1) != FALSE;
  }
  bool terminate_root(HANDLE process) {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
    if (fault == L"assign" && failed_termination++ < 10) { SetLastError(ERROR_ACCESS_DENIED); return false; }
#endif
    return TerminateProcess(process, 1) != FALSE;
  }
  bool active(HANDLE job, DWORD& count) {
#ifdef PLATFORM_PROCESS_TREE_TEST_FAULTS
    if (fault == L"query" && failed_query++ < 10) { SetLastError(ERROR_ACCESS_DENIED); return false; }
#endif
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
    if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &info, sizeof(info), nullptr)) return false;
    count = info.ActiveProcesses; return true;
  }
};

struct LegacyRoot { HANDLE process; bool assigned; };
static bool legacy_drain(HANDLE job, std::vector<LegacyRoot>& roots, ManagedWindowsApi& api, DWORD budget, bool retry_termination, DWORD& active) {
  const ULONGLONG deadline = GetTickCount64() + budget;
  for (;;) {
    if (retry_termination) {
      api.terminate_job(job);
      for (const auto& root : roots) if (!root.assigned) api.terminate_root(root.process);
    }
    bool exited = true;
    for (const auto& root : roots) if (WaitForSingleObject(root.process, 0) != WAIT_OBJECT_0) exited = false;
    const bool queried = api.active(job, active);
    if (!queried) active = static_cast<DWORD>(-1);
    if (exited && queried && active == 0) {
      for (const auto& root : roots) CloseHandle(root.process);
      roots.clear();
      return true;
    }
    if (budget && GetTickCount64() >= deadline) return false;
    Sleep(10);
  }
}

// Existing Desktop control mode remains product wiring until P12B. Its Job safety and
// actual release proof are the same Platform mechanism; protocol errors never drop handles.
static int run_control_bridge() {
  _setmode(0, _O_BINARY); _setmode(1, _O_BINARY);
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) return static_cast<int>(GetLastError());
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) { const DWORD error = GetLastError(); CloseHandle(job); return static_cast<int>(error); }
  ManagedWindowsApi api;
  std::vector<LegacyRoot> roots;
  DWORD active = static_cast<DWORD>(-1);
  for (;;) {
    DWORD size{};
    if (!std::cin.read(reinterpret_cast<char*>(&size), 4) || size > 1024 * 1024) break;
    std::vector<char> body(size);
    if (!std::cin.read(body.data(), size)) break;
    size_t p = 0; DWORD op{}, argc{}; std::string session, program, cwd;
    if (!read32(body, p, op) || !readString(body, p, session)) { reply(ERROR_INVALID_PARAMETER, "", 0, static_cast<DWORD>(-1)); continue; }
    if (op == 1) {
      if (!readString(body, p, program) || !readString(body, p, cwd) || !read32(body, p, argc)) { reply(ERROR_INVALID_PARAMETER, session, 0, static_cast<DWORD>(-1)); continue; }
      std::wstring command = quote(wide(program)); bool valid = true;
      for (DWORD i = 0; i < argc; ++i) { std::string arg; if (!readString(body, p, arg)) { valid = false; break; } command += L" " + quote(wide(arg)); }
      if (!valid || p != body.size()) { reply(ERROR_INVALID_PARAMETER, session, 0, static_cast<DWORD>(-1)); continue; }
      STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION root{}; const auto work = wide(cwd);
      if (!CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, work.c_str(), &startup, &root)) { reply(GetLastError(), session, 0, static_cast<DWORD>(-1)); continue; }
      const bool assigned = api.assign(job, root.hProcess);
      DWORD error = assigned ? 0 : GetLastError();
      roots.push_back({root.hProcess, assigned});
      if (assigned && api.resume(root.hThread) == static_cast<DWORD>(-1)) error = GetLastError();
      CloseHandle(root.hThread);
      if (!error && !api.active(job, active)) error = GetLastError();
      if (error) {
        // Keep suspended/unassigned roots too, until actual handles signal and query succeeds.
        legacy_drain(job, roots, api, 0, true, active);
        reply(error, session, root.dwProcessId, 0);
      } else reply(0, session, root.dwProcessId, active);
    } else if (op == 2) {
      if (!api.terminate_job(job)) { reply(GetLastError(), session, 0, static_cast<DWORD>(-1)); continue; }
      if (legacy_drain(job, roots, api, 5000, false, active)) { reply(0, session, 0, 0); break; }
      reply(WAIT_TIMEOUT, session, 0, active);
    } else reply(ERROR_INVALID_PARAMETER, session, 0, static_cast<DWORD>(-1));
  }
  // EOF closes admission, but KILL_ON_JOB_CLOSE alone is not a synchronous release receipt.
  legacy_drain(job, roots, api, 0, true, active);
  CloseHandle(job);
  return 0;
}

static int run_managed_launch(int argc, wchar_t** argv) {
  STARTUPINFOW inherited{}; inherited.cb = sizeof(inherited); GetStartupInfoW(&inherited);
  if (inherited.cbReserved2 < sizeof(DWORD) || !inherited.lpReserved2) return ERROR_INVALID_HANDLE;
  DWORD descriptors{}; memcpy(&descriptors, inherited.lpReserved2, sizeof(descriptors));
  if (descriptors <= 4 || sizeof(DWORD) + descriptors * (1 + sizeof(intptr_t)) > inherited.cbReserved2) return ERROR_INVALID_HANDLE;
  const HANDLE control = reinterpret_cast<HANDLE>(_get_osfhandle(4));
  if (control == INVALID_HANDLE_VALUE || !SetHandleInformation(control, HANDLE_FLAG_INHERIT, 0)) return ERROR_INVALID_HANDLE;
  _setmode(4, _O_BINARY);
  const auto not_created = [](DWORD error) {
    managed_reply("managed.not-created", error, 0, 0);
    return static_cast<int>(error);
  };
  if (argc < 3) return not_created(ERROR_INVALID_PARAMETER);
  std::vector<BYTE> descriptor_table(inherited.lpReserved2, inherited.lpReserved2 + inherited.cbReserved2);
  const intptr_t invalid = -1;
  for (DWORD fd = 4; fd < descriptors; ++fd) {
    descriptor_table[sizeof(DWORD) + fd] = 0;
    memcpy(descriptor_table.data() + sizeof(DWORD) + descriptors + fd * sizeof(intptr_t), &invalid, sizeof(invalid));
  }
  std::wstring command;
  for (int i = 2; i < argc; ++i) { if (i > 2) command += L' '; command += quote(argv[i]); }
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) return not_created(GetLastError());
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) { const DWORD error = GetLastError(); CloseHandle(job); return not_created(error); }
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  startup.StartupInfo.cbReserved2 = inherited.cbReserved2; startup.StartupInfo.lpReserved2 = descriptor_table.data();
  std::vector<HANDLE> allowed;
  for (DWORD fd = 0; fd < 4; ++fd) {
    if (descriptor_table[sizeof(DWORD) + fd] == 0) continue;
    intptr_t raw{}; memcpy(&raw, descriptor_table.data() + sizeof(DWORD) + descriptors + fd * sizeof(intptr_t), sizeof(raw));
    const HANDLE handle = reinterpret_cast<HANDLE>(raw);
    if (raw != -1 && std::find(allowed.begin(), allowed.end(), handle) == allowed.end()) allowed.push_back(handle);
  }
  SIZE_T attribute_bytes{}; InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_bytes);
  std::vector<BYTE> attribute_storage(attribute_bytes); startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute_storage.data());
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attribute_bytes)) { const DWORD error = GetLastError(); CloseHandle(job); return not_created(error); }
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, allowed.data(), allowed.size() * sizeof(HANDLE), nullptr, nullptr)) { const DWORD error = GetLastError(); DeleteProcThreadAttributeList(startup.lpAttributeList); CloseHandle(job); return not_created(error); }
  PROCESS_INFORMATION root{};
  const bool created = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr, &startup.StartupInfo, &root) != FALSE;
  const DWORD create_error = created ? 0 : GetLastError();
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  if (!created) { CloseHandle(job); return not_created(create_error); }
  ManagedWindowsApi api;
  const bool assigned = api.assign(job, root.hProcess);
  DWORD startup_error = assigned ? 0 : GetLastError();
  // Close the wrapper duplicates; only the target retains its standard streams and FD3.
  for (DWORD fd = 0; fd < 4; ++fd) if (inherited.lpReserved2[sizeof(DWORD) + fd] != 0) _close(static_cast<int>(fd));
  if (assigned && api.resume(root.hThread) == static_cast<DWORD>(-1)) startup_error = GetLastError();
  CloseHandle(root.hThread);
  DWORD active = static_cast<DWORD>(-1);
  bool connected = true;
  bool ready = false;
  bool root_exited = false;
  DWORD root_code = STILL_ACTIVE;
  std::vector<char> pending;
  bool cleanup_required = startup_error != 0;
  bool reported_query_failure = false;
  bool reported_cleanup_failure = false;
  bool stopping = false;
  ULONGLONG deadline = 0;
  if (startup_error) connected = managed_reply("managed.error", startup_error, root.dwProcessId, active);
  for (;;) {
    // An unassigned suspended root is still owned by its process handle. Failed termination
    // never drops it. A lost parent closes admission but does not discard release proof.
    if (!connected || cleanup_required) {
      const bool terminated = assigned ? api.terminate_job(job) : api.terminate_root(root.hProcess);
      if (!terminated && !reported_cleanup_failure) {
        const DWORD error = GetLastError();
        if (connected) connected = managed_reply("managed.error", error, root.dwProcessId, active);
        reported_cleanup_failure = true;
      }
    }
    const bool queried = api.active(job, active);
    if (!queried) {
      if (!reported_query_failure && connected) connected = managed_reply("managed.error", GetLastError(), root.dwProcessId, static_cast<DWORD>(-1));
      reported_query_failure = true;
      cleanup_required = true;
      // Keep the actual Job and root handles for retry; do not infer emptiness from a query error.
    }
    if (!root_exited && WaitForSingleObject(root.hProcess, 0) == WAIT_OBJECT_0) {
      if (GetExitCodeProcess(root.hProcess, &root_code)) {
        root_exited = true;
        if (connected) connected = managed_reply("managed.root-exited", root_code, root.dwProcessId, queried ? active : static_cast<DWORD>(-1));
      } else cleanup_required = true;
    }
    if (queried && !ready && !root_exited && !startup_error && !cleanup_required) {
      connected = managed_reply("managed.ready", 0, root.dwProcessId, active);
      ready = true;
    }
    if (root_exited && queried && active == 0) {
      if (connected) connected = managed_reply("managed.released", 0, root.dwProcessId, 0);
      break;
    }
    if (connected) {
      DWORD available = 0;
      if (!PeekNamedPipe(control, nullptr, 0, nullptr, &available, nullptr)) { connected = false; cleanup_required = true; }
      else if (available > 0) {
        char bytes[64]; DWORD read = 0;
        if (!ReadFile(control, bytes, std::min<DWORD>(available, sizeof(bytes)), &read, nullptr) || read == 0) { connected = false; cleanup_required = true; }
        else pending.insert(pending.end(), bytes, bytes + read);
        while (connected && pending.size() >= 8) {
          DWORD op{}, budget{}; memcpy(&op, pending.data(), 4); memcpy(&budget, pending.data() + 4, 4); pending.erase(pending.begin(), pending.begin() + 8);
          if (op != 2 || budget == 0 || budget > 2147483647) { connected = managed_reply("managed.error", ERROR_INVALID_PARAMETER, root.dwProcessId, active); continue; }
          const bool terminated = assigned ? api.terminate_job(job) : api.terminate_root(root.hProcess);
          if (!terminated) { connected = managed_reply("managed.error", GetLastError(), root.dwProcessId, active); continue; }
          stopping = true; deadline = GetTickCount64() + budget;
        }
      }
    }
    if (connected && stopping && GetTickCount64() >= deadline) {
      connected = managed_reply("managed.error", WAIT_TIMEOUT, root.dwProcessId, active);
      stopping = false; // Retain this Job owner and accept a new bounded stop attempt.
    }
    Sleep(10);
  }
  CloseHandle(root.hProcess); CloseHandle(job);
  return connected && startup_error == 0 ? static_cast<int>(root_code) : ERROR_PROCESS_ABORTED;
}
int wmain(int argc, wchar_t** argv) {
  if (argc > 1 && std::wstring(argv[1]) == L"--managed-launch") return run_managed_launch(argc, argv);
  return run_control_bridge();
}
