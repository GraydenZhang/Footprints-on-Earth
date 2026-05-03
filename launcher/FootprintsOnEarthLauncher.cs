using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace FootprintsOnEarth
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }

    internal sealed class LauncherForm : Form
    {
        private const int Port = 5174;
        private readonly string url = "http://127.0.0.1:5174/";
        private readonly Label statusLabel;
        private readonly Label hintLabel;
        private LocalStaticServer server;

        public LauncherForm()
        {
            Text = "Footprints on Earth";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(500, 230);
            BackColor = Color.FromArgb(24, 27, 27);
            ForeColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

            var titleLabel = new Label();
            titleLabel.AutoSize = true;
            titleLabel.Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold, GraphicsUnit.Point);
            titleLabel.Text = "Footprints on Earth";
            titleLabel.Location = new Point(28, 24);
            Controls.Add(titleLabel);

            statusLabel = new Label();
            statusLabel.AutoSize = false;
            statusLabel.Width = 440;
            statusLabel.Height = 54;
            statusLabel.Location = new Point(30, 76);
            statusLabel.Text = "正在启动本地服务...";
            statusLabel.ForeColor = Color.FromArgb(219, 224, 220);
            Controls.Add(statusLabel);

            hintLabel = new Label();
            hintLabel.AutoSize = false;
            hintLabel.Width = 440;
            hintLabel.Height = 34;
            hintLabel.Location = new Point(30, 132);
            hintLabel.Text = "关闭这个窗口即可终止服务进程。";
            hintLabel.ForeColor = Color.FromArgb(166, 174, 170);
            Controls.Add(hintLabel);

            var openButton = new Button();
            openButton.Text = "打开浏览器";
            openButton.Width = 130;
            openButton.Height = 36;
            openButton.Location = new Point(220, 172);
            openButton.Click += delegate { OpenBrowser(); };
            Controls.Add(openButton);

            var closeButton = new Button();
            closeButton.Text = "停止并关闭";
            closeButton.Width = 130;
            closeButton.Height = 36;
            closeButton.Location = new Point(360, 172);
            closeButton.Click += delegate { Close(); };
            Controls.Add(closeButton);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            StartServer();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (server != null)
            {
                server.Dispose();
                server = null;
            }

            base.OnFormClosing(e);
        }

        private void StartServer()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string webRoot = Path.Combine(baseDir, "web");
            bool hasWebFolder = Directory.Exists(webRoot);
            bool hasEmbeddedContent = LocalStaticServer.HasEmbeddedContent();

            if (!hasWebFolder && !hasEmbeddedContent)
            {
                statusLabel.Text = "未找到 web 文件夹，也没有内置演示资源。";
                hintLabel.Text = "服务未启动。";
                MessageBox.Show(this, statusLabel.Text, "Footprints on Earth", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            try
            {
                string root = hasWebFolder ? webRoot : baseDir;
                server = new LocalStaticServer(root, Port);
                server.Start();

                string sourceText = hasWebFolder ? "正在使用 web 文件夹中的演示文件。" : "正在使用 exe 内置演示文件。";
                statusLabel.Text = "本地服务已启动：" + url + Environment.NewLine + sourceText;
                hintLabel.Text = "保持此窗口打开即可使用；关闭窗口会停止服务。";
                OpenBrowser();
            }
            catch (SocketException ex)
            {
                statusLabel.Text = "端口 5174 已被占用，服务未启动。";
                hintLabel.Text = "请先关闭占用 5174 的旧服务，再重新双击此程序。";
                MessageBox.Show(this, statusLabel.Text + Environment.NewLine + ex.Message, "Footprints on Earth", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            catch (Exception ex)
            {
                statusLabel.Text = "服务启动失败。";
                hintLabel.Text = ex.Message;
                MessageBox.Show(this, ex.ToString(), "Footprints on Earth", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenBrowser()
        {
            try
            {
                var startInfo = new ProcessStartInfo();
                startInfo.FileName = url;
                startInfo.UseShellExecute = true;
                Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "无法自动打开浏览器：" + ex.Message + Environment.NewLine + url, "Footprints on Earth", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }

    internal sealed class LocalStaticServer : IDisposable
    {
        private static readonly Dictionary<string, string> EmbeddedResources = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "index.html", "index.html" },
            { "app.js", "app.js" },
            { "styles.css", "styles.css" },
            { "data/footprint_test_file.csv", "data/footprint_test_file.csv" }
        };

        private readonly string root;
        private readonly int port;
        private TcpListener listener;
        private Thread listenThread;
        private volatile bool running;

        public LocalStaticServer(string root, int port)
        {
            this.root = Path.GetFullPath(root);
            this.port = port;
        }

        public static bool HasEmbeddedContent()
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("index.html");
            if (stream == null) return false;
            stream.Dispose();
            return true;
        }

        public void Start()
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            running = true;
            listenThread = new Thread(ListenLoop);
            listenThread.IsBackground = true;
            listenThread.Start();
        }

        public void Dispose()
        {
            running = false;
            if (listener != null)
            {
                try { listener.Stop(); }
                catch { }
                listener = null;
            }
        }

        private void ListenLoop()
        {
            while (running)
            {
                TcpClient client = null;
                try
                {
                    client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { HandleClient(client); });
                }
                catch
                {
                    if (client != null)
                    {
                        try { client.Close(); }
                        catch { }
                    }

                    if (!running) return;
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            using (client)
            {
                NetworkStream stream = client.GetStream();
                stream.ReadTimeout = 5000;
                byte[] buffer = new byte[8192];
                int count;
                try
                {
                    count = stream.Read(buffer, 0, buffer.Length);
                }
                catch
                {
                    return;
                }

                if (count <= 0) return;

                string request = Encoding.ASCII.GetString(buffer, 0, count);
                string firstLine = request.Split(new string[] { "\r\n" }, StringSplitOptions.None)[0];
                string[] parts = firstLine.Split(' ');
                if (parts.Length < 2)
                {
                    SendText(stream, "400 Bad Request", "Bad request");
                    return;
                }

                string method = parts[0].ToUpperInvariant();
                if (method != "GET" && method != "HEAD")
                {
                    SendText(stream, "405 Method Not Allowed", "Method not allowed");
                    return;
                }

                string relativePath = ResolveRelativePath(parts[1]);
                if (relativePath == null)
                {
                    SendText(stream, "404 Not Found", "Not found");
                    return;
                }

                string externalPath = ResolveExternalPath(relativePath);
                if (externalPath != null && File.Exists(externalPath))
                {
                    SendFile(stream, externalPath, method == "HEAD");
                    return;
                }

                Stream embeddedStream = OpenEmbeddedStream(relativePath);
                if (embeddedStream != null)
                {
                    using (embeddedStream)
                    {
                        SendStream(stream, embeddedStream, GetMimeType(Path.GetExtension(relativePath)), method == "HEAD");
                    }
                    return;
                }

                SendText(stream, "404 Not Found", "Not found");
            }
        }

        private string ResolveRelativePath(string rawPath)
        {
            int queryIndex = rawPath.IndexOf('?');
            if (queryIndex >= 0) rawPath = rawPath.Substring(0, queryIndex);

            string decoded;
            try
            {
                decoded = Uri.UnescapeDataString(rawPath);
            }
            catch
            {
                return null;
            }

            decoded = decoded.Replace('\\', '/');
            if (decoded.StartsWith("/")) decoded = decoded.Substring(1);
            if (decoded.Length == 0) decoded = "index.html";
            return decoded;
        }

        private string ResolveExternalPath(string relativePath)
        {
            string localRelative = relativePath.Replace('/', Path.DirectorySeparatorChar);
            string fullPath = Path.GetFullPath(Path.Combine(root, localRelative));
            string safeRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!fullPath.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase)) return null;
            if (Directory.Exists(fullPath)) fullPath = Path.Combine(fullPath, "index.html");
            return fullPath;
        }

        private static Stream OpenEmbeddedStream(string relativePath)
        {
            string resourceName;
            if (!EmbeddedResources.TryGetValue(relativePath.Replace('\\', '/'), out resourceName)) return null;
            return Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
        }

        private static void SendFile(NetworkStream stream, string filePath, bool headerOnly)
        {
            using (FileStream fs = File.OpenRead(filePath))
            {
                SendStream(stream, fs, GetMimeType(Path.GetExtension(filePath)), headerOnly);
            }
        }

        private static void SendStream(NetworkStream stream, Stream content, string mimeType, bool headerOnly)
        {
            string header = "HTTP/1.1 200 OK\r\n" +
                            "Content-Type: " + mimeType + "\r\n" +
                            "Content-Length: " + content.Length.ToString() + "\r\n" +
                            "Cache-Control: no-store\r\n" +
                            "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (headerOnly) return;

            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = content.Read(buffer, 0, buffer.Length)) > 0)
            {
                stream.Write(buffer, 0, read);
            }
        }

        private static void SendText(NetworkStream stream, string status, string text)
        {
            byte[] body = Encoding.UTF8.GetBytes(text);
            string header = "HTTP/1.1 " + status + "\r\n" +
                            "Content-Type: text/plain; charset=utf-8\r\n" +
                            "Content-Length: " + body.Length.ToString() + "\r\n" +
                            "Cache-Control: no-store\r\n" +
                            "Connection: close\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
        }

        private static string GetMimeType(string extension)
        {
            switch ((extension ?? "").ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".csv": return "text/csv; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".svg": return "image/svg+xml; charset=utf-8";
                case ".ico": return "image/x-icon";
                default: return "application/octet-stream";
            }
        }
    }
}
