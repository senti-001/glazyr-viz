#ifndef COMPONENTS_MCP_MCP_CLIENT_H_
#define COMPONENTS_MCP_MCP_CLIENT_H_

#include <memory>
#include <string>
#include <vector>
#include <map>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "components/mcp/mcp_transport.h"

namespace mcp {

// Manages a connection to a single MCP server.
// Handles JSON-RPC serialization/deserialization.
class McpClient {
 public:
  explicit McpClient(std::unique_ptr<McpTransport> transport);
  ~McpClient();

  // Initialize the connection (send 'initialize' request).
  void Initialize();

  // Callback for when initialization completes.
  using InitCallback = base::OnceCallback<void(bool success)>;
  void SetInitCallback(InitCallback callback);

  // Send a tool call request.
  using ToolCallback = base::OnceCallback<void(base::Value result)>;
  void CallTool(const std::string& tool_name, const base::Value::Dict& args, ToolCallback callback);

 private:
  void OnMessageReceived(const std::string& message);
  void SendRequest(const std::string& method, base::Value::Dict params);

  std::unique_ptr<McpTransport> transport_;
  InitCallback init_callback_;
  
  // Pending request callbacks (map request_id -> callback)
  // std::map<int, ToolCallback> pending_requests_;
  
  base::WeakPtrFactory<McpClient> weak_factory_{this};
};

}  // namespace mcp

#endif  // COMPONENTS_MCP_MCP_CLIENT_H_
