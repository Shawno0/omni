let portCursor = 25000;

export function allocatePort(): number {
  const port = portCursor;
  portCursor += 1;
  if (portCursor > 40000) {
    portCursor = 25000;
  }

  return port;
}
