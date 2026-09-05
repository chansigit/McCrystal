using System.Net;
using System.Net.WebSockets;
using Crystal.Web;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5080");
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var root = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, ".."));
builder.Services.AddSingleton(new GameAssets(Path.Combine(root, "Build/Client/Debug")));
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
app.UseStaticFiles();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
app.MapGet("/health", () => Results.Ok(new { status = "ready", server = "127.0.0.1:7000" }));
app.MapGet("/assets/sound", (int id, GameAssets assets) => assets.Sound(id) is { } path
    ? Results.File(path, "audio/wav", enableRangeProcessing: true) : Results.NotFound());
app.MapGet("/assets/frame", (string library, int index, GameAssets assets) =>
{
    try
    {
        var frame = assets.Frame(library, index);
        return frame is null ? Results.NotFound() : Results.File(frame.Png, "image/png");
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
