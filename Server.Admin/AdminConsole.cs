using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Server.MirEnvir;

namespace Server.Admin
{
    public sealed class AdminConsole
    {
        public static readonly LogBuffer Logs = new LogBuffer();

        private const string CookieName = "mc_admin";
        private readonly Envir envir;
        private readonly string password;
        private readonly int port;
        private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        private WebApplication app;

        public string BaseUrl { get; private set; }

        public AdminConsole(Envir envir, string password, int port)
        {
            this.envir = envir;
            this.password = password;
            this.port = port;
        }

        public void Start()
        {
            var service = new AdminService(envir);
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
            app = builder.Build();

            // Static page from the copied AdminConsole folder next to the binaries.
            var pageRoot = Path.Combine(AppContext.BaseDirectory, "AdminConsole");
            if (Directory.Exists(pageRoot))
            {
                var files = new PhysicalFileProvider(pageRoot);
                app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
                app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
            }
            else
            {
                app.MapGet("/", () => Results.Text("Admin console page files are missing (AdminConsole/index.html).", "text/plain"));
            }

            app.Use(async (context, next) =>
            {
                var path = context.Request.Path.Value ?? string.Empty;
                if (path.StartsWith("/api/", StringComparison.Ordinal) && path != "/api/login")
                {
                    if (!context.Request.Cookies.TryGetValue(CookieName, out var cookie) || cookie != token)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsJsonAsync(new { error = "login required" });
                        return;
                    }
                }
                await next();
            });

            app.MapPost("/api/login", (LoginRequest body, HttpContext context) =>
            {
                if (body == null || body.Password != password)
                    return Results.Json(new { error = "wrong password" }, statusCode: StatusCodes.Status401Unauthorized);
                context.Response.Cookies.Append(CookieName, token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict });
                return Results.Ok(new { ok = true });
            });
            app.MapPost("/api/logout", (HttpContext context) =>
            {
                context.Response.Cookies.Delete(CookieName);
                return Results.Ok(new { ok = true });
            });

            app.MapGet("/api/overview", () => service.GetOverview());
            app.MapGet("/api/players", () => service.GetOnlinePlayers());
            app.MapGet("/api/accounts", (string q) => service.SearchAccounts(q));
            app.MapGet("/api/accounts/{id}", (string id) =>
            {
                var detail = service.GetAccount(id);
                return detail == null ? Results.NotFound(new { error = "no such account" }) : Results.Ok(detail);
            });
            app.MapGet("/api/db/items", (string q) => service.SearchItems(q));
            app.MapGet("/api/db/monsters", (string q) => service.SearchMonsters(q));
            app.MapGet("/api/db/maps", (string q) => service.SearchMaps(q));
            app.MapGet("/api/db/npcs", (string q) => service.SearchNpcs(q));
            app.MapGet("/api/stats", () => service.GetStatistics());

            app.MapGet("/api/logs", (long? after) => Logs.After(after ?? 0));
            app.MapGet("/api/logs/stream", async (HttpContext context, long? after) =>
            {
                context.Response.Headers.ContentType = "text/event-stream";
                context.Response.Headers.CacheControl = "no-cache";
                long cursor = after ?? Math.Max(0, Logs.LastSequence - 200);
                while (!context.RequestAborted.IsCancellationRequested)
                {
                    foreach (var entry in Logs.After(cursor))
                    {
                        cursor = entry.Sequence;
                        var json = System.Text.Json.JsonSerializer.Serialize(entry, JsonOptions);
                        await context.Response.WriteAsync($"data: {json}\n\n", context.RequestAborted);
                    }
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                    try { await Task.Delay(500, context.RequestAborted); } catch (TaskCanceledException) { }
                }
            });

            app.MapPost("/api/players/{name}/give-item", (string name, GiveItemRequest body) => Result(service.GiveItem(name, body.Item, body.Count)));
            app.MapPost("/api/players/{name}/give-gold", (string name, GiveGoldRequest body) => Result(service.GiveGold(name, body.Amount)));
            app.MapPost("/api/players/{name}/teleport", (string name, TeleportRequest body) => Result(service.Teleport(name, body.MapIndex, body.X, body.Y)));
            app.MapPost("/api/players/{name}/level", (string name, LevelRequest body) => Result(service.SetLevel(name, body.Level)));
            app.MapPost("/api/players/{name}/kick", (string name) => Result(service.Kick(name)));
            app.MapPost("/api/players/{name}/whisper", (string name, MessageRequest body) => Result(service.Whisper(name, body.Message)));
            app.MapPost("/api/accounts/{id}/password", (string id, PasswordRequest body) => Result(service.ResetPassword(id, body.Password)));
            app.MapPost("/api/accounts/{id}/admin", (string id, AdminRequest body) => Result(service.SetAdmin(id, body.Admin)));
            app.MapPost("/api/server/broadcast", (MessageRequest body) => Result(service.Broadcast(body.Message)));
            app.MapPost("/api/server/save", () => Result(service.SaveNow()));
            app.MapPost("/api/server/reload-drops", () => Result(service.ReloadDrops()));
            app.MapPost("/api/server/reload-npcs", () => Result(service.ReloadNpcs()));

            app.Start();
            BaseUrl = app.Urls.First();
        }

        public void Stop()
        {
            if (app == null) return;
            app.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
            app.DisposeAsync().AsTask().GetAwaiter().GetResult();
            app = null;
        }

        private static readonly System.Text.Json.JsonSerializerOptions JsonOptions =
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);

        private static IResult Result(AdminActionResult result)
        {
            return result.Ok
                ? Results.Ok(new { ok = true, message = result.Message })
                : Results.BadRequest(new { ok = false, error = result.Message });
        }

        public sealed class LoginRequest { public string Password { get; set; } }
        public sealed class GiveItemRequest { public string Item { get; set; } public int Count { get; set; } = 1; }
        public sealed class GiveGoldRequest { public uint Amount { get; set; } }
        public sealed class TeleportRequest { public int MapIndex { get; set; } public int? X { get; set; } public int? Y { get; set; } }
        public sealed class LevelRequest { public int Level { get; set; } }
        public sealed class MessageRequest { public string Message { get; set; } }
        public sealed class PasswordRequest { public string Password { get; set; } }
        public sealed class AdminRequest { public bool Admin { get; set; } }
    }
}
