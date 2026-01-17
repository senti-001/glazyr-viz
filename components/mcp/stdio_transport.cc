#include "components/mcp/stdio_transport.h"

#include "base/logging.h"

namespace mcp {

StdioTransport::StdioTransport(const std::string& command, const std::vector<std::string>& args)
    : command_(command), args_(args), reader_thread_("McpReaderThread") {}

StdioTransport::~StdioTransport() {
  Close();
}

void StdioTransport::Start(ReadCallback read_callback) {
  LOG(ERROR) << "StdioTransport::Start not implemented on this platform (yet)";
  // TODO: Re-implement Windows pipe logic carefully
}

void StdioTransport::Send(const std::string& message) {
  LOG(ERROR) << "StdioTransport::Send not implemented";
}

bool StdioTransport::IsConnected() const {
  return false;
}

void StdioTransport::Close() {
  running_ = false;
}

void StdioTransport::ReadLoop() {
  // no-op
}

}  // namespace mcp
