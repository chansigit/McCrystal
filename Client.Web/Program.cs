using System.Net;
using System.Net.WebSockets;
using Crystal.Web;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5080");

// --server host:port, or MCCRYSTAL_GAME_SERVER, picks which pack's server to relay to.
{
    var selection = args.SkipWhile(a => a != "--server").Skip(1).FirstOrDefault()
        ?? Environment.GetEnvironmentVariable("MCCRYSTAL_GAME_SERVER");
    if (!string.IsNullOrWhiteSpace(selection))
    {
        var parts = selection.Split(':');
        if (parts.Length == 2 && int.TryParse(parts[1], out int port))
            Crystal.Web.GameSession.GameServer = (parts[0], port);
        else if (int.TryParse(selection, out int only))
            Crystal.Web.GameSession.GameServer = ("127.0.0.1", only);
    }
}
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var root = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, ".."));
// The client has to draw the same maps the server is running, or every coordinate the
// server sends lands on different terrain -- silently, because both sets are valid maps
// with the same names. --pack reads the location out of the same manifest the server was
// started with, so the two halves cannot drift apart by forgetting a flag; --maps still
// overrides it for a one-off.
var packPath = args.SkipWhile(a => a != "--pack").Skip(1).FirstOrDefault()
    ?? Environment.GetEnvironmentVariable("MCCRYSTAL_PACK");
var mapRoot = args.SkipWhile(a => a != "--maps").Skip(1).FirstOrDefault()
    ?? Environment.GetEnvironmentVariable("MCCRYSTAL_MAP_ROOT");
if (string.IsNullOrWhiteSpace(mapRoot) && !string.IsNullOrWhiteSpace(packPath))
{
    try { mapRoot = Server.ContentPacks.ContentPack.Load(packPath).MapPath; }
    catch (Exception e) when (e is IOException or UnauthorizedAccessException or YamlDotNet.Core.YamlException)
    {
        Console.Error.WriteLine($"Could not read pack {packPath}: {e.Message}");
        Environment.Exit(1);
    }
}
builder.Services.AddSingleton(new GameAssets(Path.Combine(root, "Build/Client/Debug"),
    string.IsNullOrWhiteSpace(mapRoot) ? null : Path.GetFullPath(mapRoot)));
var app = builder.Build();
Packet.IsServer = false;
app.Use(async (context, next) =>
{
    if (context.Connection.RemoteIpAddress is not { } ip || !IPAddress.IsLoopback(ip) ||
        context.Request.Host.Host is not ("127.0.0.1" or "localhost"))
    {
        context.Response.StatusCode = 403;
        return;
    }
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] = "frame-ancestors 'none'";
    await next();
});
app.UseDefaultFiles();
// The bundle and the page that loads it are rebuilt constantly and share one filename, so
// without this the browser keeps running whichever build it happened to cache and the fix
// you just made appears not to have worked. no-cache still revalidates rather than
// refetching, so a cold reload costs one 304.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
        context.Context.Response.Headers.CacheControl = "no-cache, must-revalidate"
});
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
app.MapGet("/health", () => Results.Ok(new { status = "ready",
    server = $"{Crystal.Web.GameSession.GameServer.Host}:{Crystal.Web.GameSession.GameServer.Port}",
    maps = mapRoot ?? "(client)" }));
app.MapGet("/assets/sound", (int id, GameAssets assets) => assets.Sound(id) is { } path
    ? Results.File(path, "audio/wav", enableRangeProcessing: true) : Results.NotFound());
app.MapGet("/assets/frame", (string library, int index, GameAssets assets) =>
{
    try
    {
        var frame = assets.Frame(library, index);
        return frame is null ? Results.NotFound() : Results.File(frame.Png, frame.ContentType);
    }
    catch (Exception e) when (e is ArgumentException or IOException) { return Results.NotFound(); }
});
app.MapGet("/assets/library", (string library, GameAssets assets) =>
{
    try { return Results.Json(assets.Manifest(library)); }
    catch (Exception e) when (e is ArgumentException or IOException) { return Results.NotFound(); }
});
app.MapGet("/assets/map", (string name, GameAssets assets) =>
{
    try { return Results.Json(assets.Map(name)); }
    catch (Exception e) when (e is ArgumentException or IOException) { return Results.NotFound(); }
});
app.Map("/game", async context =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme != "http" ||
        uri.Authority != context.Request.Host.Value || !context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 403;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await GameSession.Run(socket, Path.Combine(root, "Build/Client/Debug/Client.dll"), context.RequestAborted);
});
app.Run();
