// Length-prefixed binary protocol; fields are UTF-8 length/value pairs, never parsed JSON.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <vector>

static bool read32(const std::vector<char>& b, size_t& p, DWORD& v) { if (p + 4 > b.size()) return false; memcpy(&v, b.data() + p, 4); p += 4; return true; }
static bool readString(const std::vector<char>& b, size_t& p, std::string& v) { DWORD n{}; if (!read32(b,p,n) || p+n > b.size()) return false; v.assign(b.data()+p,n); p += n; return true; }
static void put32(std::vector<char>& b, DWORD v) { const auto p = reinterpret_cast<const char*>(&v); b.insert(b.end(), p, p+4); }
static void putString(std::vector<char>& b, const std::string& v) { put32(b, static_cast<DWORD>(v.size())); b.insert(b.end(), v.begin(), v.end()); }
static std::wstring wide(const std::string& value) { const auto n = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0); std::wstring out(n, L'\0'); MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), n); return out; }
static std::wstring quote(const std::wstring& value) { std::wstring out = L"\""; unsigned slashes = 0; for (wchar_t ch : value) { if (ch == L'\\') { ++slashes; continue; } if (ch == L'\"') out.append(slashes * 2 + 1, L'\\'); else out.append(slashes, L'\\'); slashes = 0; out += ch; } out.append(slashes * 2, L'\\'); return out + L"\""; }
static void reply(DWORD code, const std::string& session, DWORD pid, DWORD active) { std::vector<char> body; put32(body, code); putString(body, session); put32(body,pid); put32(body,active); const DWORD n = static_cast<DWORD>(body.size()); std::cout.write(reinterpret_cast<const char*>(&n),4); std::cout.write(body.data(),body.size()); std::cout.flush(); }

int main() {
  HANDLE job = CreateJobObjectW(nullptr, nullptr); JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 2;
  for (;;) { DWORD size{}; if (!std::cin.read(reinterpret_cast<char*>(&size),4) || size > 1024*1024) break; std::vector<char> body(size); if (!std::cin.read(body.data(),size)) break; size_t p=0; DWORD op{}, argc{}; std::string session, program, cwd; if (!read32(body,p,op) || !readString(body,p,session)) { reply(2,"",0,0); continue; }
    if (op == 1 && readString(body,p,program) && readString(body,p,cwd) && read32(body,p,argc)) { std::wstring command = quote(wide(program)); for (DWORD i=0;i<argc;i++) { std::string arg; if (!readString(body,p,arg)) { reply(2,session,0,0); goto next; } command += L" " + quote(wide(arg)); }
      STARTUPINFOW si{}; si.cb=sizeof(si); PROCESS_INFORMATION pi{}; const auto work=wide(cwd); if (!CreateProcessW(nullptr,command.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW,nullptr,work.c_str(),&si,&pi) || !AssignProcessToJobObject(job,pi.hProcess)) { if(pi.hProcess) TerminateProcess(pi.hProcess,1); if(pi.hThread) CloseHandle(pi.hThread); if(pi.hProcess) CloseHandle(pi.hProcess); reply(2,session,0,0); goto next; }
      ResumeThread(pi.hThread); DWORD pid=pi.dwProcessId; CloseHandle(pi.hThread); CloseHandle(pi.hProcess); JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{}; QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&info,sizeof(info),nullptr); reply(0,session,pid,info.ActiveProcesses); }
    else if (op == 2) { if (!TerminateJobObject(job,1)) { reply(3,session,0,static_cast<DWORD>(-1)); continue; } JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{}; DWORD active=static_cast<DWORD>(-1); for (DWORD elapsed=0; elapsed<5000; elapsed+=25) { if (!QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&info,sizeof(info),nullptr)) break; active=info.ActiveProcesses; if (active==0) break; Sleep(25); } if (active==0) { CloseHandle(job); job=nullptr; reply(0,session,0,0); break; } reply(3,session,0,active); }
    else reply(2,session,0,0); next:; }
  if(job) CloseHandle(job); return 0;
}
