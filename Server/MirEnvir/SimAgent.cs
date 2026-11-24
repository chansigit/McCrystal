using Server.MirNetwork;
using Server.MirObjects;
using C = ClientPackets;

namespace Server.MirEnvir
{
    /// <summary>
    /// A character that lives inside the server process: no socket, no client. It holds a
    /// virtual connection and acts by injecting the same client packets a player's client
    /// would send, so every rule the server enforces on players applies to it unchanged.
    /// All members must be used on the engine thread.
    /// </summary>
    public sealed class SimAgent
    {
        private const string Password = "simagent";

        public int Number { get; private set; }
        public string AccountID { get; private set; }
        public string Name { get; private set; }
        public MirConnection Connection { get; private set; }

        /// <summary>The character in the world, or null if it is not in the game.</summary>
        public PlayerObject Player => Connection.Player;

        /// <summary>Times the character has died since it was spawned.</summary>
        public int Deaths { get; private set; }

        // Counters a policy's results are judged by. Kills and experience come from the
        // packets the server sends the character, the same ones a client would count.
        public int Kills { get; private set; }
        public long ExperienceGained { get; private set; }
        public long GoldGained { get; private set; }
        public long GoldSpent { get; private set; }
        public int PotionsUsed, PotionsBought, ItemsSold, GearBought, GearEquipped, Repairs, Harvests, Reliefs;

        /// <summary>Items the server would not let this character wear, by item index.</summary>
        public readonly HashSet<int> RefusedGear = new HashSet<int>();

        private void Count(Packet packet)
        {
            LastPacket = packet;
            switch (packet)
            {
                case ServerPackets.GainExperience gained:
                    Kills++;
                    ExperienceGained += gained.Amount;
                    break;
                case ServerPackets.GainedGold gold:
                    GoldGained += gold.Gold;
                    break;
                case ServerPackets.LoseGold gold:
                    GoldSpent += gold.Gold;
                    break;
            }
        }

        /// <summary>Where the character last died, and the name of what hit it last.</summary>
        public System.Drawing.Point DeathLocation { get; private set; }
        public string DeathCause { get; private set; }

        private bool _wasDead;

        /// <summary>Counts a death the first time the character is seen dead.</summary>
        public void TrackDeath()
        {
            var dead = Player != null && Player.Dead;
            if (dead && !_wasDead)
            {
                Deaths++;
                DeathLocation = Player.CurrentLocation;
                DeathCause = Player.LastHitter?.Name;
            }
            _wasDead = dead;
        }

        /// <summary>The last server packet this agent received.</summary>
        public Packet LastPacket { get; private set; }

        /// <summary>
        /// Brings agent <paramref name="number"/> into the game: opens a virtual connection,
        /// then creates the account and the character if this state directory does not
        /// have them yet, logs in and starts the game. Each step goes through the normal
        /// packet handlers and is checked before the next.
        /// </summary>
        public static SimAgent Spawn(Envir envir, int number, MirClass mirClass = MirClass.Warrior, MirGender gender = MirGender.Male)
        {
            var agent = new SimAgent
            {
                Number = number,
                AccountID = $"simagent{number:D5}",
                Name = $"Agent{number:D5}",
                Connection = envir.OpenVirtualConnection(),
            };
            var connection = agent.Connection;
            connection.PacketSink = agent.Count;

            if (!envir.AccountExists(agent.AccountID))
            {
                agent.Send(new C.NewAccount { AccountID = agent.AccountID, Password = Password, BirthDate = new DateTime(2000, 1, 1) });
                if (!envir.AccountExists(agent.AccountID)) throw agent.Failure("create its account");
            }

            agent.Send(new C.Login { AccountID = agent.AccountID, Password = Password });
            if (connection.Account == null || connection.Stage != GameStage.Select) throw agent.Failure("log in");

            var character = connection.Account.Characters.FirstOrDefault(c => !c.Deleted && c.Name == agent.Name);
            if (character == null)
            {
                agent.Send(new C.NewCharacter { Name = agent.Name, Gender = gender, Class = mirClass });
                character = connection.Account.Characters.FirstOrDefault(c => !c.Deleted && c.Name == agent.Name);
                if (character == null) throw agent.Failure("create its character");
            }

            agent.Send(new C.StartGame { CharacterIndex = character.Index });
            if (connection.Player == null || connection.Stage != GameStage.Game) throw agent.Failure("enter the game");

            return agent;
        }

        /// <summary>Hands the server one client packet and lets it act on it at once.</summary>
        public void Send(Packet packet)
        {
            Connection.Inject(packet);
            Connection.Process();
        }

        /// <summary>
        /// Puts the character back to level 1 with no experience. Position, inventory and
        /// skills are left as they are: what a training reset should cover is decided with
        /// the observation and reward design, not here.
        /// </summary>
        public void ResetLevel()
        {
            var player = Player;
            if (player == null) return;

            player.Level = 1;
            player.Experience = 0;
            player.LevelUp();
        }

        private InvalidOperationException Failure(string step) =>
            new InvalidOperationException(
                $"Simulation agent {Name} could not {step}. Stage {Connection.Stage}, last reply {LastPacket?.GetType().Name ?? "none"}.");
    }
}
