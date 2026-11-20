// GT Planner launcher. Serves the files next to GTPlanner.exe on http://127.0.0.1:8099/ and opens the planner in its own
// app-style window (Edge or Chrome "--app" mode, with a private profile so your boards and data are kept).
// The server stops by itself a few seconds after the window is closed.
// Built with the C# compiler that ships with Windows: see tools\build_exe.ps1 (C# 5 syntax on purpose).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("GT Planner")]
[assembly: AssemblyProduct("GT Planner")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    const int Port = 8099;
    static string Root;
    static HttpListener listener;
    static int active;
    static DateTime started = DateTime.UtcNow;
    static DateTime lastEnd = DateTime.UtcNow;
    static volatile bool everAlive;
    static volatile bool stopping;

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" }, { ".png", "image/png" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        { ".txt", "text/plain; charset=utf-8" }, { ".md", "text/plain; charset=utf-8" }
    };

    [STAThread]
    static void Main(string[] args)
    {
        Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        bool noBrowser = Array.IndexOf(args, "--no-browser") >= 0;      // used for testing: serve only
        string url = "http://127.0.0.1:" + Port + "/";

        if (!File.Exists(Path.Combine(Root, "index.html")))
        {
            MessageBox.Show("index.html was not found next to GTPlanner.exe.\nKeep GTPlanner.exe inside the gt-planner folder.", "GT Planner");
            return;
        }

        listener = new HttpListener();
        listener.Prefixes.Add(url);
        try { listener.Start(); }
        catch (HttpListenerException)
        {
            // already running (or the port is taken by something else)
            if (IsOurServer(url)) { if (!noBrowser) OpenWindow(url); return; }
            MessageBox.Show("Port " + Port + " is already used by another program, so GT Planner cannot start.\nClose that program and try again.", "GT Planner");
            return;
        }

        if (!noBrowser) OpenWindow(url);
        Thread monitor = new Thread(Monitor);
        monitor.IsBackground = true;
        monitor.Start();

        while (!stopping)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch (Exception) { break; }
            ThreadPool.QueueUserWorkItem(Handle, ctx);
        }
        try { listener.Close(); } catch (Exception) { }
    }

    // Stops the server once the window has been closed (no open keep-alive request for a while).
    static void Monitor()
    {
        while (!stopping)
        {
            Thread.Sleep(1000);
            bool idle = Interlocked.CompareExchange(ref active, 0, 0) == 0 && everAlive && (DateTime.UtcNow - lastEnd).TotalSeconds > 10;
            bool neverOpened = !everAlive && (DateTime.UtcNow - started).TotalSeconds > 120;
            if (idle || neverOpened)
            {
                stopping = true;
                try { listener.Stop(); } catch (Exception) { }
            }
        }
    }

    static bool IsOurServer(string url)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url + "__gtplanner");
            req.Timeout = 1500;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader r = new StreamReader(resp.GetResponseStream()))
                return r.ReadToEnd() == "GTPlanner";
        }
        catch (Exception) { return false; }
    }

    static void OpenWindow(string url)
    {
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GTPlanner", "profile");
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = new string[]
        {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe")
        };
        foreach (string exe in candidates)
        {
            if (!File.Exists(exe)) continue;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe,
                    "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=1440,900 --no-first-run --no-default-browser-check");
                psi.UseShellExecute = false;
                Process.Start(psi);
                return;
            }
            catch (Exception) { }
        }
        try { Process.Start(url); }                                      // no Edge/Chrome found: use the default browser
        catch (Exception) { MessageBox.Show("Could not open a browser. Open " + url + " yourself.", "GT Planner"); }
    }

    static void Handle(object state)
    {
        HttpListenerContext ctx = (HttpListenerContext)state;
        try
        {
            string path = ctx.Request.Url.AbsolutePath;
            if (path == "/__gtplanner") { Text(ctx, "GTPlanner"); return; }
            if (path == "/alive") { Alive(ctx); return; }
            Serve(ctx, path);
        }
        catch (Exception)
        {
            try { ctx.Response.Abort(); } catch (Exception) { }
        }
    }

    static void Text(HttpListenerContext ctx, string s)
    {
        byte[] b = System.Text.Encoding.UTF8.GetBytes(s);
        ctx.Response.ContentType = "text/plain; charset=utf-8";
        ctx.Response.ContentLength64 = b.Length;
        ctx.Response.OutputStream.Write(b, 0, b.Length);
        ctx.Response.Close();
    }

    // Long-poll: the page keeps one of these open. When the window closes, the next one never arrives.
    static void Alive(HttpListenerContext ctx)
    {
        Interlocked.Increment(ref active);
        everAlive = true;
        try
        {
            for (int i = 0; i < 200 && !stopping; i++) Thread.Sleep(100);
            Text(ctx, "ok");
        }
        catch (Exception) { }
        finally
        {
            Interlocked.Decrement(ref active);
            lastEnd = DateTime.UtcNow;
        }
    }

    static void Serve(HttpListenerContext ctx, string urlPath)
    {
        string rel = Uri.UnescapeDataString(urlPath).TrimStart('/');
        if (rel.Length == 0) rel = "index.html";
        string full = Path.GetFullPath(Path.Combine(Root, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(Root, StringComparison.OrdinalIgnoreCase)) { ctx.Response.StatusCode = 403; ctx.Response.Close(); return; }
        if (!File.Exists(full)) { ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }

        string mime;
        if (!Mime.TryGetValue(Path.GetExtension(full), out mime)) mime = "application/octet-stream";
        ctx.Response.ContentType = mime;
        ctx.Response.AddHeader("Cache-Control", "no-cache");
        using (FileStream fs = File.OpenRead(full))
        {
            ctx.Response.ContentLength64 = fs.Length;
            if (ctx.Request.HttpMethod != "HEAD")
            {
                byte[] buf = new byte[65536];
                int n;
                while ((n = fs.Read(buf, 0, buf.Length)) > 0) ctx.Response.OutputStream.Write(buf, 0, n);
            }
        }
        ctx.Response.Close();
    }
}
