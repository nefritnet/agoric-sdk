// All the kernel metrics we are prepared for.
export const KERNEL_STATS_SUM_METRICS = [
  {
    key: 'syscalls',
    name: 'swingset_syscall_total',
    description: 'Total number of SwingSet kernel calls',
  },
  {
    key: 'syscallSend',
    name: 'swingset_syscall_send_total',
    description: 'Total number of SwingSet message send kernel calls',
  },
  {
    key: 'syscallCallNow',
    name: 'swingset_syscall_call_now_total',
    description: 'Total number of SwingSet synchronous device kernel calls',
  },
  {
    key: 'syscallSubscribe',
    name: 'swingset_syscall_subscribe_total',
    description: 'Total number of SwingSet promise subscription kernel calls',
  },
  {
    key: 'syscallResolve',
    name: 'swingset_syscall_resolve_total',
    description: 'Total number of SwingSet promise resolution kernel calls',
  },
  {
    key: 'dispatches',
    name: 'swingset_dispatch_total',
    description: 'Total number of SwingSet vat calls',
  },
  {
    key: 'dispatchDeliver',
    name: 'swingset_dispatch_deliver_total',
    description: 'Total number of SwingSet vat message deliveries',
  },
  {
    key: 'dispatchNotify',
    name: 'swingset_dispatch_notify_total',
    description: 'Total number of SwingSet vat promise notifications',
  },
];

export const KERNEL_STATS_UPDOWN_METRICS = [
  {
    key: 'kernelObjects',
    name: 'swingset_kernel_objects',
    description: 'Active kernel objects',
  },
  {
    key: 'kernelDevices',
    name: 'swingset_kernel_devices',
    description: 'Active kernel devices',
  },
  {
    key: 'kernelPromises',
    name: 'swingset_kernel_promises',
    description: 'Active kernel promises',
  },
  {
    key: 'kpUnresolved',
    name: 'swingset_unresolved_kernel_promises',
    description: 'Unresolved kernel promises',
  },
  {
    key: 'kpFulfilled',
    name: 'swingset_fulfilled_kernel_promises',
    description: 'Fulfilled kernel promises',
  },
  {
    key: 'kpRejected',
    name: 'swingset_rejected_kernel_promises',
    description: 'Rejected kernel promises',
  },
  {
    key: 'runQueueLength',
    name: 'swingset_run_queue_length',
    description: 'Length of the kernel run queue',
  },
  {
    key: 'clistEntries',
    name: 'swingset_clist_entries',
    description: 'Number of entries in the kernel c-list',
  },
];

export const KERNEL_STATS_METRICS = [
  ...KERNEL_STATS_SUM_METRICS.map(m => ({ ...m, metricType: 'counter' })),
  ...KERNEL_STATS_UPDOWN_METRICS.map(m => ({ ...m, metricType: 'gauge' })),
];
