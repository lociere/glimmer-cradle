// Desktop-owned Windows process-tree authority. Protocol: one JSON request/response per stdio line.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <vector>

static std::string field(const std::string& json, const char* name) {
  const std::string key = std::string("\"") + name + "\":\"";
  const auto begin = json.find(key); if (begin == std::string::npos) return "";
  const auto value = begin + key.size(); const auto end = json.find('"', value);
  return end == std::string::npos ? "" : json.substr(value, end - value);
}
static std::string id(const std::string& json) { return field(json, "request_id"); }
static std::string session(const std::string& json) { return field(json, "session"); }
static void reply(const std::string& requestId, const std::string& body) { std::cout << "{\"request_id\":\"" << requestId << "\"," << body << "}\n" << std::flush; }

int wmain() {
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 2;
  DWORD rootPid = 0;
  std::string line;
  while (std::getline(std::cin, line)) {
    const auto requestId = id(line); const auto op = field(line, "op");
    if (op == "start" && rootPid == 0) {
      // Node sends a fully quoted command line. CREATE_SUSPENDED makes Job assignment atomic with launch.
      auto command = field(line, "command_line");
      std::wstring wide(command.begin(), command.end());
      STARTUPINFOW startup{}; startup.cb = sizeof(startup); PROCESS_INFORMATION process{};
      if (wide.empty() || !CreateProcessW(nullptr, wide.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process) || !AssignProcessToJobObject(job, process.hProcess)) {
        if (process.hProcess) TerminateProcess(process.hProcess, 1); if (process.hThread) CloseHandle(process.hThread); if (process.hProcess) CloseHandle(process.hProcess);
        reply(requestId, "\"status\":\"failed\",\"error_code\":\"job_start_failed\""); continue;
      }
      rootPid = process.dwProcessId; ResumeThread(process.hThread); CloseHandle(process.hThread); CloseHandle(process.hProcess);
      reply(requestId, "\"status\":\"started\",\"session\":\"" + session(line) + "\",\"root_pid\":" + std::to_string(rootPid) + ",\"active_process_count\":1"); continue;
    }
    if (op == "stop") {
      CloseHandle(job); job = nullptr; rootPid = 0;
      reply(requestId, "\"status\":\"terminated\",\"session\":\"" + session(line) + "\",\"active_process_count\":0"); break;
    }
    reply(requestId, "\"status\":\"failed\",\"error_code\":\"invalid_request\"");
  }
  if (job) CloseHandle(job);
  return 0;
}
