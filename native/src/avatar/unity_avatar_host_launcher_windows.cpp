#include <windows.h>

#include <filesystem>
#include <cstdlib>
#include <cwchar>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

DWORD g_child_process_id = 0;
std::unordered_set<HWND> g_isolated_windows;

void isolate_worker_window(HWND window) {
    if (window == nullptr || !IsWindow(window) || GetAncestor(window, GA_ROOT) != window) {
        return;
    }
    DWORD process_id = 0;
    GetWindowThreadProcessId(window, &process_id);
    if (process_id != g_child_process_id || g_isolated_windows.find(window) != g_isolated_windows.end()) {
        return;
    }
    wchar_t class_name[128]{};
    GetClassNameW(window, class_name, static_cast<int>(sizeof(class_name) / sizeof(class_name[0])));
    if (std::wstring(class_name) != L"UnityWndClass") {
        return;
    }

    auto ex_style = static_cast<LONG_PTR>(GetWindowLongPtrW(window, GWL_EXSTYLE));
    ex_style &= ~static_cast<LONG_PTR>(WS_EX_APPWINDOW);
    ex_style |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED;
    SetWindowLongPtrW(window, GWL_EXSTYLE, ex_style);
    SetLayeredWindowAttributes(window, 0, 0, LWA_ALPHA);
    SetWindowPos(
        window,
        HWND_BOTTOM,
        -32000,
        -32000,
        64,
        64,
        SWP_NOACTIVATE | SWP_FRAMECHANGED
    );
    g_isolated_windows.insert(window);
}

BOOL CALLBACK enumerate_worker_windows(HWND window, LPARAM) {
    isolate_worker_window(window);
    return TRUE;
}

void CALLBACK handle_window_event(
    HWINEVENTHOOK,
    DWORD,
    HWND window,
    LONG object_id,
    LONG child_id,
    DWORD,
    DWORD
) {
    if (object_id == OBJID_WINDOW && child_id == CHILDID_SELF) {
        isolate_worker_window(window);
    }
}

std::wstring quote_argument(const std::wstring& value) {
    if (value.find_first_of(L" \t\"") == std::wstring::npos) {
        return value;
    }
    std::wstring quoted = L"\"";
    size_t backslashes = 0;
    for (wchar_t character : value) {
        if (character == L'\\') {
            ++backslashes;
            continue;
        }
        if (character == L'\"') {
            quoted.append(backslashes * 2 + 1, L'\\');
            quoted.push_back(L'\"');
        } else {
            quoted.append(backslashes, L'\\');
            quoted.push_back(character);
        }
        backslashes = 0;
    }
    quoted.append(backslashes * 2, L'\\');
    quoted.push_back(L'\"');
    return quoted;
}

std::filesystem::path launcher_directory() {
    std::vector<wchar_t> buffer(32768);
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
}

HANDLE open_supervisor_process() {
    wchar_t value[32]{};
    const DWORD length = GetEnvironmentVariableW(
        L"GLIMMER_CRADLE_SUPERVISOR_PID",
        value,
        static_cast<DWORD>(sizeof(value) / sizeof(value[0]))
    );
    if (length == 0 || length >= sizeof(value) / sizeof(value[0])) {
        return nullptr;
    }
    wchar_t* end = nullptr;
    const unsigned long parsed = std::wcstoul(value, &end, 10);
    if (end == value || *end != L'\0' || parsed == 0) {
        return nullptr;
    }
    return OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(parsed));
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 2) {
        return ERROR_BAD_ARGUMENTS;
    }

    std::filesystem::path executable = argv[1];
    if (executable.is_relative()) {
        executable = launcher_directory() / executable;
    }
    executable = std::filesystem::weakly_canonical(executable);
    if (!std::filesystem::exists(executable)) {
        return ERROR_FILE_NOT_FOUND;
    }

    std::wstring command_line = quote_argument(executable.wstring());
    for (int index = 2; index < argc; ++index) {
        command_line.push_back(L' ');
        command_line.append(quote_argument(argv[index]));
    }
    std::vector<wchar_t> mutable_command(command_line.begin(), command_line.end());
    mutable_command.push_back(L'\0');

    STARTUPINFOW startup_info{};
    startup_info.cb = sizeof(startup_info);
    startup_info.dwFlags = STARTF_USESTDHANDLES;
    startup_info.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup_info.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup_info.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process_info{};

    const HANDLE child_job = CreateJobObjectW(nullptr, nullptr);
    if (child_job == nullptr) {
        return static_cast<int>(GetLastError());
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_limits{};
    job_limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(
            child_job,
            JobObjectExtendedLimitInformation,
            &job_limits,
            sizeof(job_limits))) {
        const DWORD error = GetLastError();
        CloseHandle(child_job);
        return static_cast<int>(error);
    }

    const auto working_directory = executable.parent_path().wstring();
    if (!CreateProcessW(
            executable.c_str(),
            mutable_command.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP,
            nullptr,
            working_directory.c_str(),
            &startup_info,
            &process_info)) {
        const DWORD error = GetLastError();
        CloseHandle(child_job);
        return static_cast<int>(error);
    }

    if (!AssignProcessToJobObject(child_job, process_info.hProcess)) {
        const DWORD error = GetLastError();
        TerminateProcess(process_info.hProcess, error);
        CloseHandle(process_info.hThread);
        CloseHandle(process_info.hProcess);
        CloseHandle(child_job);
        return static_cast<int>(error);
    }

    g_child_process_id = process_info.dwProcessId;
    const HANDLE supervisor_process = open_supervisor_process();
    const HWINEVENTHOOK event_hook = SetWinEventHook(
        EVENT_OBJECT_CREATE,
        EVENT_OBJECT_SHOW,
        nullptr,
        handle_window_event,
        process_info.dwProcessId,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );
    ResumeThread(process_info.hThread);
    CloseHandle(process_info.hThread);

    bool supervisor_exited = false;
    HANDLE wait_handles[] = {process_info.hProcess, supervisor_process};
    const DWORD wait_handle_count = supervisor_process == nullptr ? 1 : 2;
    MSG message{};
    while (true) {
        const DWORD wait_result = WaitForMultipleObjects(
            wait_handle_count,
            wait_handles,
            FALSE,
            2
        );
        if (wait_result == WAIT_OBJECT_0) {
            break;
        }
        if (wait_handle_count == 2 && wait_result == WAIT_OBJECT_0 + 1) {
            supervisor_exited = true;
            break;
        }
        if (wait_result != WAIT_TIMEOUT) {
            supervisor_exited = true;
            break;
        }
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        EnumWindows(enumerate_worker_windows, 0);
    }

    if (event_hook != nullptr) {
        UnhookWinEvent(event_hook);
    }
    if (supervisor_process != nullptr) {
        CloseHandle(supervisor_process);
    }
    if (supervisor_exited) {
        CloseHandle(child_job);
        WaitForSingleObject(process_info.hProcess, 5000);
    }
    DWORD exit_code = 1;
    GetExitCodeProcess(process_info.hProcess, &exit_code);
    CloseHandle(process_info.hProcess);
    if (!supervisor_exited) {
        CloseHandle(child_job);
    }
    return supervisor_exited ? ERROR_PROCESS_ABORTED : static_cast<int>(exit_code);
}
