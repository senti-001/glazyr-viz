#ifndef COMPONENTS_MCP_MCP_TRANSPORT_H_
#define COMPONENTS_MCP_MCP_TRANSPORT_H_

#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"

namespace mcp {

// Abstract base class for MCP transports (Stdio, SSE, etc.)
class McpTransport {
 public:
  virtual ~McpTransport() = default;

  // Callback for receiving JSON-RPC messages from the server.
  using ReadCallback = base::RepeatingCallback<void(const std::string&)>;

  // Start the transport connection.
  virtual void Start(ReadCallback read_callback) = 0;

  // Send a JSON-RPC message to the server.
  virtual void Send(const std::string& message) = 0;

  // Check if transport is connected.
  virtual bool IsConnected() const = 0;

  // Close the connection.
  virtual void Close() = 0;
};

}  // namespace mcp

#endif  // COMPONENTS_MCP_MCP_TRANSPORT_H_
