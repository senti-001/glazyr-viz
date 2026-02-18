// NC-INNOVATION: eBPF Session Monitor
// Location: third_party/neural/ebpf/session_monitor.c
// Goal: Enforce MPK-aligned system call filtering for multi-tenant isolation.

#include <bpf/bpf_helpers.h>
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <linux/sched.h>


SEC("tracepoint/syscalls/sys_enter_open")
int bpf_prog_check_open(struct trace_event_raw_sys_enter *ctx) {
  // 1. Recover the MPK key (pkey) from the current task's memory context.
  struct task_struct *task = (struct task_struct *)bpf_get_current_task();

  // 2. Logic: If the thread has an active session pkey (non-zero),
  // verify the target file path is within the allowed /tmp/session_X/ sandbox.

  // char filename[256];
  // bpf_probe_read_user_str(filename, sizeof(filename), (void *)ctx->args[0]);

  // if (is_denied_path(filename) && has_active_pkey(task)) {
  //    return -1; // Block the syscall
  // }

  return 0;
}

char _license[] SEC("license") = "GPL";
